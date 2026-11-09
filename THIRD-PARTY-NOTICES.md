# Third-party notices

Ports and models under `adapters/` derive from, or were written by reading, the projects below at
the commits named. Their sources are not included in this repository.

| Path | Project | Commit | License | Copyright |
| --- | --- | --- | --- | --- |
| `adapters/alien/` | alien-signals, <https://github.com/stackblitz/alien-signals> | `8734d38` | MIT | Johnson Chu |
| `adapters/polyfill/` | signal-polyfill, <https://github.com/proposal-signals/signal-polyfill> | `fba09f8` | Apache-2.0 | its contributors |
| `adapters/wpf/` | Windows Presentation Foundation, <https://github.com/dotnet/wpf> | `49ae5cd` | MIT | .NET Foundation and Contributors |
| `adapters/salsa/` | Salsa, <https://github.com/salsa-rs/salsa> | `6d59529` | MIT or Apache-2.0 | its contributors |
| `adapters/quant/` | Reflex Quant, <https://github.com/volynetstyle/reflex-quant> | `241a3b7` | MIT | Andrii Volynets |

**`adapters/polyfill/`** contains files modified from signal-polyfill: its relational state was
moved onto the reference machine of this repository, and variants were added for ablation. Those
files remain under Apache-2.0, whose text is in `adapters/polyfill/LICENSE`.

The texts of the MIT-licensed projects' notices apply to the portions derived from them:

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software
> and associated documentation files (the "Software"), to deal in the Software without
> restriction, including without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
> Software is furnished to do so, subject to the following conditions: The above copyright notice
> and this permission notice shall be included in all copies or substantial portions of the
> Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
> AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
