#!/usr/bin/env python3
"""按各页在 git 里的真实最后改动日期，刷新 site/public/sitemap.xml 的 <lastmod>。

为什么要有它：sitemap 的 lastmod 手工维护极易过时——一旦声明的日期早于页面真实改动，
等于告诉搜索引擎"这之后没变过"，反而拖慢重新收录，比不写还糟。本脚本从 git 历史取每个
<loc> 对应源文件的最后提交日期，就地回填，令 lastmod 永远与真实内容同步。

用法：改完官网页面、提交后，运行 `python3 scripts/refresh-sitemap.py`（部署前跑一次即可）。
纯就地改写、幂等；只动 <lastmod>，不碰 changefreq/priority/hreflang。
"""
import io
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITEMAP = ROOT / "site/public/sitemap.xml"

# <loc> URL → 对应源文件（相对仓库根）。新增页面时在此登记一行。
LOC_TO_FILE = {
    "https://beeurei.hikosphere.com/": "site/public/index.html",
    "https://beeurei.hikosphere.com/legal/": "site/public/legal/index.html",
    "https://beeurei.hikosphere.com/accessibility/": "site/public/accessibility/index.html",
    "https://beeurei.hikosphere.com/tech/": "site/public/tech/index.html",
}


def git_last_date(path: str) -> str | None:
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cd", "--date=short", "--", path],
            cwd=ROOT, text=True,
        ).strip()
        return out or None
    except subprocess.CalledProcessError:
        return None


def main() -> int:
    s = io.open(SITEMAP, encoding="utf-8").read()
    changed = 0
    for loc, fpath in LOC_TO_FILE.items():
        date = git_last_date(fpath)
        if not date:
            print(f"⚠ 无 git 历史，跳过：{fpath}", file=sys.stderr)
            continue
        pat = re.compile(r"(<loc>" + re.escape(loc) + r"</loc>\s*<lastmod>)[^<]*(</lastmod>)")
        s2, n = pat.subn(rf"\g<1>{date}\g<2>", s)
        if n != 1:
            print(f"⚠ sitemap 中未唯一匹配 {loc}（命中 {n} 次）", file=sys.stderr)
            continue
        if s2 != s:
            changed += 1
        s = s2
    io.open(SITEMAP, "w", encoding="utf-8").write(s)
    print(f"sitemap lastmod 已刷新（{changed} 处更新）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
