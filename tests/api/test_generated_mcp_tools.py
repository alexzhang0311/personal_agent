import os
import tempfile
import unittest

from vivian.api.services.mcp.built_in import resolve_generated_files


class GeneratedMcpToolsTests(unittest.TestCase):
    def test_resolves_relative_and_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            nested_dir = os.path.join(tmpdir, "reports")
            os.makedirs(nested_dir, exist_ok=True)
            absolute_path = os.path.join(nested_dir, "report.pdf")
            with open(absolute_path, "wb") as f:
                f.write(b"%PDF-1.4")

            files = resolve_generated_files(["reports/report.pdf", absolute_path], tmpdir)
            resolved_path = os.path.realpath(absolute_path)

            self.assertEqual(len(files), 1)
            self.assertEqual(files[0]["path"], resolved_path)
            self.assertEqual(files[0]["relative_path"], os.path.join("reports", "report.pdf"))
            self.assertEqual(files[0]["name"], "report.pdf")
            self.assertEqual(files[0]["extension"], ".pdf")
            self.assertEqual(files[0]["size"], 8)

    def test_rejects_missing_paths(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaisesRegex(ValueError, "Generated file not found"):
                resolve_generated_files(["missing.pdf"], tmpdir)

    def test_rejects_directories(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            folder = os.path.join(tmpdir, "exports")
            os.makedirs(folder, exist_ok=True)

            with self.assertRaisesRegex(ValueError, "not a file"):
                resolve_generated_files(["exports"], tmpdir)

    def test_rejects_workspace_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with tempfile.NamedTemporaryFile(delete=False) as other:
                other.write(b"hello")
                other_path = other.name
            try:
                with self.assertRaisesRegex(ValueError, "outside the workspace"):
                    resolve_generated_files([other_path], tmpdir)
            finally:
                os.unlink(other_path)


if __name__ == "__main__":
    unittest.main()
