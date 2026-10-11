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
