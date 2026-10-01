import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import stamp_assets as sa


class Stamp(unittest.TestCase):
    def test_html_links_get_version(self):
        html = '<link rel="stylesheet" href="style.css">\n<script type="module" src="app.js"></script>\n' \
               '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>'
        out = sa.stamp_html(html, "abc123")
        self.assertIn('href="style.css?v=abc123"', out)
        self.assertIn('src="app.js?v=abc123"', out)
        self.assertIn('chart.umd.min.js"', out)  # external URLs untouched

    def test_js_relative_imports_get_version(self):
        js = 'import * as M from "./metrics.js";\nimport { el } from "./ui.js";\nconst x = "./not-an-import.js";'
        out = sa.stamp_js(js, "abc123")
        self.assertIn('from "./metrics.js?v=abc123"', out)
        self.assertIn('from "./ui.js?v=abc123"', out)
        self.assertIn('"./not-an-import.js"', out)

    def test_stamp_dir_is_idempotent_per_version(self):
        with TemporaryDirectory() as tmp:
            d = Path(tmp)
            (d / "index.html").write_text('<script type="module" src="app.js"></script>')
            (d / "app.js").write_text('import * as M from "./metrics.js";')
            sa.stamp_dir(d, "v1")
            sa.stamp_dir(d, "v1")
            self.assertEqual((d / "index.html").read_text(), '<script type="module" src="app.js?v=v1"></script>')
            self.assertEqual((d / "app.js").read_text(), 'import * as M from "./metrics.js?v=v1";')


if __name__ == "__main__":
    unittest.main()
