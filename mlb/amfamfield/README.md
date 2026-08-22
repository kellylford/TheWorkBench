# American Family Field — accessible section guide

Lives at <https://theideaplace.net/projects/mlb/amfamfield/>.

A non-visual equivalent of the MLB ticketing seat map: what a section number actually means, where
it sits, how deep it is, where the aisles and entry portals are, and how the seats are numbered.
The `mlb/` folder is set up per-stadium so other ballparks can slot in beside this one.

## Files

| File | What |
|---|---|
| `index.html` | The page. Hand-generated, self-contained, no build step at serve time |
| `american_family_field_sections.csv` | 151 sections, 14 columns — the primary dataset |
| `american_family_field_layout.csv` | 13 seating zones — the layout overview |
| `american_family_field_notes.md` | Methodology, sources, confidence ratings and known gaps |
| `build/` | The Python that generates the CSVs and the page from the source data |

The three data files are linked for download from the page itself, so they must stay in this
directory alongside `index.html`.

## Rebuilding

```
cd build
python3 build.py          # writes american_family_field_sections.csv
python3 build_layout.py   # writes american_family_field_layout.csv
python3 build_page.py     # writes amfamfield.html from both CSVs
```

`build.py` holds the section data as Python dictionaries — rows, entrance rows, zones, locations and
per-section notes. Location text and the seat-numbering explanation are *derived* from the
counter-clockwise numbering rule rather than stored per section, so a correction to the rule
propagates to all 151 sections at once.

## Publishing

Same FTPS route as the projects page, but it **must** use `-RemoteSubDir`:

```powershell
$files = 'mlb\amfamfield\index.html',
         'mlb\amfamfield\american_family_field_sections.csv',
         'mlb\amfamfield\american_family_field_layout.csv',
         'mlb\amfamfield\american_family_field_notes.md'

.\scripts\publish-site.ps1 -DryRun -RemoteSubDir mlb/amfamfield -Path $files
.\scripts\publish-site.ps1         -RemoteSubDir mlb/amfamfield -Path $files
```

`-RemoteSubDir` was added for this. Without it `publish-site.ps1` uses only the file's *name* and
ignores the local folder, so `-Path mlb\amfamfield\index.html` on its own would upload to
`projects/index.html` and **overwrite the projects page**. With it, the script also creates
`mlb/` and `mlb/amfamfield/` on the server if they are not there, one segment at a time.

All four files have to go up — the page links the three data files for download, so skipping them
gives you three 404s.

Use `-Command` rather than `-File` when passing several paths; with `powershell -File`, a
comma-separated `-Path` arrives as one string and the script reports "Not found".

Verify with a cache buster afterwards; the host caches and a plain fetch returns the previous
version:

```powershell
$u = 'https://theideaplace.net/projects/mlb/amfamfield/index.html?cb=' + [guid]::NewGuid().ToString('N')
(Invoke-WebRequest -Uri $u -UseBasicParsing).RawContentLength
```

## Accessibility

Audited with axe-core in Chromium, light and dark, against WCAG 2.0/2.1/2.2 A and AA plus
best-practice rules: **0 violations, 0 incomplete, 49 rule groups passing**. Reflow verified at 320
CSS pixels with no horizontal document scrolling. One `h1`, no skipped heading levels, all three
tables carry a caption plus column and row headers.

Two deliberate choices worth knowing before editing:

- **The scrollable table wrappers carry `role="region"` and `tabindex="0"`.** That is the standard
  fix for WCAG 2.1.1 — a container that scrolls has to be reachable and scrollable by keyboard, and
  a focusable region needs an accessible name. This adds three landmarks, which is a different
  situation from the projects page, where `aria-labelledby` on eight `<section>` elements duplicated
  eight headings for no benefit.
- **Section results render as plain `<div>` with an `<h3>`,** not `<article>`. 151 article
  boundaries is noise; the headings are the navigation mechanism.

No JavaScript is required to read any content. The filter is an enhancement and the full
151-section table is in the static markup.
