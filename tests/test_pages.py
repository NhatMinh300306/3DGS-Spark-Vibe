import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT))
from prepare_pages import copy_site, missing_dataset_files, REQUIRED_FRONTEND


class PagesTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "dist"
        self.dest = Path(self.temp.name) / "docs"
        self.source.mkdir()
        for name in REQUIRED_FRONTEND:
            (self.source / name).write_text("fixture " + name)

    def test_missing_data_stops_before_copy(self):
        self.assertEqual(len(missing_dataset_files(self.source)), 120)
        with self.assertRaises(FileNotFoundError):
            copy_site(self.source, self.dest)
        self.assertFalse(self.dest.exists())

    def test_all_data_and_code_are_copied_without_deleting_other_files(self):
        for path in missing_dataset_files(self.source):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"fixture")
        self.dest.mkdir()
        (self.dest / "keep.txt").write_text("keep")
        copy_site(self.source, self.dest)
        self.assertEqual(len(missing_dataset_files(self.dest)), 0)
        self.assertTrue((self.dest / "scenes.js").is_file())
        self.assertTrue((self.dest / ".nojekyll").is_file())
        self.assertEqual((self.dest / "keep.txt").read_text(), "keep")

    def test_frontend_only_leaves_dataset_untouched(self):
        self.dest.mkdir()
        data = self.dest / "data"
        data.mkdir()
        (data / "old.ply").write_bytes(b"old")
        copy_site(self.source, self.dest, frontend_only=True)
        self.assertEqual((data / "old.ply").read_bytes(), b"old")
        self.assertTrue((self.dest / "app.js").is_file())

    def test_rejects_overlapping_source_and_destination(self):
        with self.assertRaises(ValueError):
            copy_site(self.source, self.source / "docs", True)


if __name__ == "__main__":
    unittest.main()
