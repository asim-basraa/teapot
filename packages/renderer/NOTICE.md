# Attribution

The Markdown processing pipeline in this package follows the shape of Quartz
v5's `createMdProcessor` / `createHtmlProcessor` (see `quartz/processors/parse.ts`
in <https://github.com/jackyzha0/quartz>): parse Markdown, apply Markdown
transformers, cross to HTML with raw HTML allowed, sanitize, then apply HTML
transformers.

The Obsidian-flavoured syntax handled here (wikilinks, callouts, highlights)
follows Quartz's `ObsidianFlavoredMarkdown` transformer in behaviour, though the
implementations are our own.

Quartz's build system, emitters, filters, Preact components and CLI are not used
by this project.

Quartz is distributed under the MIT License, reproduced below.

---

MIT License

Copyright (c) 2023 Jacky Zhao

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
