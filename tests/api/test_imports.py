import importlib
import unittest


class ImportSmokeTests(unittest.TestCase):
    def test_can_import_vivian_api_main_from_repo_root(self) -> None:
        module = importlib.import_module("vivian.api.main")
        self.assertTrue(callable(module.create_app))


if __name__ == "__main__":
    unittest.main()
