import unittest

import server


class FitCopyTest(unittest.TestCase):
    def test_keeps_a_valid_pair(self):
        text = "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。"
        self.assertEqual(server.fit_copy(text, "午饭"), text)

    def test_rejects_english_short_and_three_stops(self):
        fallback = "这一页先停在看见的地方，别的都先不添上去。照片没说完的那一点，先留在这一页里面。"
        self.assertEqual(server.FALLBACK_COPY, fallback)
        for text in ("THE BOAT STAYS.", "太短。也太短。", "一二三。四五六。七八九。十"):
            self.assertEqual(server.fit_copy(text, "核"), fallback)


class DrawingPromptTest(unittest.TestCase):
    def test_prompt_fills_the_frame_and_has_no_caption(self):
        page = {
            "nucleus": "一盘午饭",
            "anchors": ["白盘", "右手"],
            "discard": "酒杯",
            "copy": "盘子里只有一点点，手刚从右边离开。那一顿比这张画停得更久，味道一点都没被拍下来。",
        }
        prompt = server.drawing_prompt(page)
        self.assertIn("一盘午饭", prompt)
        self.assertIn("白盘", prompt)
        self.assertIn("Fill the frame", prompt)
        self.assertIn("No text", prompt)
        self.assertNotIn("Top 60%", prompt)
        self.assertNotIn("No people", prompt)
        self.assertNotIn(page["copy"], prompt)


class SetDrawingTest(unittest.TestCase):
    def test_cover_cannot_become_the_drawing(self):
        session = {"story": {"pages": [{"kind": "cover"}, {"kind": "drawing"}]}}
        with self.assertRaisesRegex(RuntimeError, "封面不能改成画"):
            server.set_drawing(session, 0)

    def test_moves_the_single_drawing(self):
        session = {"story": {"pages": [
            {"kind": "cover"}, {"kind": "drawing"}, {"kind": "photo"},
        ]}}
        story = server.set_drawing(session, 2)
        self.assertEqual([page["kind"] for page in story["pages"]], ["cover", "photo", "drawing"])


class PosterGuardTest(unittest.TestCase):
    def test_photo_page_is_refused(self):
        self.assertEqual(server.poster_error({"kind": "photo"}), "这一页不用画")
        self.assertEqual(server.poster_error({"kind": "cover"}), "这一页不用画")
        self.assertIsNone(server.poster_error({"kind": "drawing"}))


class NormalizeStoryTest(unittest.TestCase):
    def test_cover_keeps_short_sentence_and_one_drawing(self):
        photos = [
            {"id": "a", "reading": {"nucleus": "雪", "anchors": ["山"], "discard": "塔"}},
            {"id": "b", "reading": {"nucleus": "路", "anchors": ["雾"], "discard": ""}},
        ]
        raw = {
            "title": "雪后",
            "pages": [
                {"photoId": "b", "copy": "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。", "draw": False},
                {"photoId": "a", "copy": "not chinese", "draw": True},
                {"photoId": "missing", "copy": "路还在雾里，两边的树只剩一层浅色。我们没有再往前走，照片把这段空空地停在了这里。"},
            ],
        }
        story = server.normalize_story(raw, photos, "雪停在远处，这一趟就从这里看过去。")
        self.assertEqual(story["title"], "雪后")
        self.assertEqual(story["pages"][0]["kind"], "cover")
        self.assertEqual(story["pages"][0]["copy"], "雪停在远处，这一趟就从这里看过去。")
        self.assertEqual(story["pages"][0]["photoId"], "b")
        self.assertEqual(story["pages"][1]["kind"], "drawing")
        self.assertEqual(story["pages"][1]["copy"], server.FALLBACK_COPY)
        self.assertNotIn("line", story["pages"][0])

    def test_empty_model_result_is_one_cover(self):
        photos = [{"id": "a", "reading": {"nucleus": "雪", "anchors": ["山"], "discard": ""}}]
        story = server.normalize_story({"pages": []}, photos, "")
        self.assertEqual(len(story["pages"]), 1)
        self.assertEqual(story["pages"][0]["kind"], "cover")
        self.assertEqual(story["pages"][0]["photoId"], "a")
        self.assertEqual(story["pages"][0]["copy"], "")


class AssignDrawingTest(unittest.TestCase):
    def test_one_page_has_no_drawing(self):
        pages = [{"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual(pages[0]["kind"], "cover")

    def test_many_flags_use_the_middle_body_page(self):
        pages = [{"draw": True}, {"draw": True}, {"draw": True}, {"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual([page["kind"] for page in pages], ["cover", "drawing", "photo", "photo"])

    def test_one_flag_wins(self):
        pages = [{}, {"draw": False}, {"draw": True}]
        server.assign_drawing(pages)
        self.assertEqual([page["kind"] for page in pages], ["cover", "photo", "drawing"])

    def test_no_flag_leaves_every_body_page_a_photo(self):
        pages = [{}, {}, {}]
        server.assign_drawing(pages)
        self.assertEqual([page["kind"] for page in pages], ["cover", "photo", "photo"])


class StoryPromptTest(unittest.TestCase):
    def test_rules_keep_the_second_sentence_off_the_photo(self):
        self.assertIn("第二句只写照片里没有的", server.STORY_RULES)
        self.assertIn("至多一页", server.STORY_RULES)
        self.assertNotIn("纸刊", server.STORY_RULES)
        self.assertNotIn("只有一页 draw 为 true", server.STORY_RULES)
        session = {"sentence": "雪停在远处。", "photos": []}
        prompt = server.story_prompt(session, [], [], "雾很冷")
        self.assertIn(server.STORY_RULES, prompt)
        self.assertIn("雪停在远处。", prompt)
        self.assertIn("雾很冷", prompt)
        self.assertIn("没有额外情节", prompt)

    def test_none_check_names_the_events(self):
        self.assertEqual(server.none_check(), {"id": "none", "text": "这几件都没发生"})


class AuthorCopyTest(unittest.TestCase):
    def test_cover_sentence_can_be_empty_and_rejects_ascii(self):
        self.assertEqual(server.author_sentence("  雪停在远处。  "), "雪停在远处。")
        self.assertEqual(server.author_sentence(""), "")
        self.assertEqual(len(server.author_sentence("句" * 80)), 80)
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("句" * 81)
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("Snow。")
        with self.assertRaisesRegex(RuntimeError, "这句话先改成中文，80 字以内"):
            server.author_sentence("雪。\n")

    def test_body_can_be_short_and_rejects_one_sentence(self):
        self.assertEqual(server.author_copy("雾。冷。"), "雾。冷。")
        eighty = "测" * 77 + "。完。"
        self.assertEqual(len(eighty), 80)
        self.assertEqual(server.author_copy(eighty), eighty)
        for text in ("只有一句。", "路。A。", "测" * 78 + "。完。", "雾。冷。啊", "雾。\n冷。"):
            with self.assertRaisesRegex(RuntimeError, "这一页要正好两句，80 字以内"):
                server.author_copy(text)

    def test_set_copy_keeps_the_previous_text_on_failure(self):
        session = {"sentence": "旧句。", "story": {"sentence": "旧句。", "pages": [
            {"kind": "cover", "copy": "旧句。"},
            {"kind": "photo", "copy": "雾在路上。冷在镜头外。"},
        ]}}
        with self.assertRaises(RuntimeError):
            server.set_copy(session, 1, "只有一句。")
        self.assertEqual(session["story"]["pages"][1]["copy"], "雾在路上。冷在镜头外。")
        story = server.set_copy(session, 0, "新的一句。")
        self.assertEqual(story["sentence"], "新的一句。")
        self.assertEqual(session["sentence"], "新的一句。")
        self.assertEqual(story["pages"][0]["copy"], "新的一句。")

    def test_clear_drawing_leaves_photos(self):
        session = {"story": {"pages": [
            {"kind": "cover"}, {"kind": "drawing"}, {"kind": "photo"},
        ]}}
        story = server.clear_drawing(session)
        self.assertEqual([page["kind"] for page in story["pages"]], ["cover", "photo", "photo"])
        for page in story["pages"]:
            self.assertEqual(server.poster_error(page), "这一页不用画")

    def test_take_sentence_ignores_a_missing_field(self):
        session = {"sentence": "旧句。"}
        server.take_sentence(session, {})
        self.assertEqual(session["sentence"], "旧句。")
        server.take_sentence(session, {"sentence": "新句。"})
        self.assertEqual(session["sentence"], "新句。")
