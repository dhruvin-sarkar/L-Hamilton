<div align="center">

<a href="https://l-hamilton.vercel.app">
  <img src="media/hero.webp" width="100%" alt="The home page hero. Moving the pointer across Lewis Hamilton's portrait paints his helmet over it with a fluid simulation.">
</a>

<h1>Lewis Hamilton</h1>


<a href="https://l-hamilton.vercel.app">
  <img src="https://img.shields.io/badge/open%20the%20live%20site-l--hamilton.vercel.app-ff2800?style=for-the-badge" alt="Open the live site: l-hamilton.vercel.app">
</a>


</div>

## 

A remake of [landonorris.com](https://landonorris.com) 

The structure, the sections and the scroll mechanics follow that site. The driver, the palette
(Ferrari red in place of McLaren lime) and all of the career data are Hamilton's. Each effect was
studied on the original as it runs, measured, and rebuilt in a new codebase: a WebGL hero, pinned
and scrubbed scroll sections, a 3D circuit map
<div align="center">
  <img src="media/phones.webp" width="100%" alt="Five phone screens: the home hero, the helmet wall, On Track, Off Track and the Calendar with its 3D circuit.">
</div>

## The pages

### Home 

<img src="media/home.webp" width="100%" alt="Scrolling the home page: the portrait shrinks into a plate, a signature is drawn over it, and the opening statement reveals line by line.">

The opening is one pinned sequence. The portrait closes into a plate while two bands of text run
past it, a signature is drawn over it stroke by stroke, and the statement reveals behind an accent
bar. Below it: a photo collage, the On Track and Off Track doors, the helmet wall, the store,
partners, socials and the footer.

<table>
  <tr>
    <td width="50%"><img src="media/on-off-track.webp" alt="Two cut-out portraits close in from the edges around the On Track and Off Track links, then a photograph rises over them."></td>
    <td width="50%"><img src="media/helmets.webp" alt="Scrolling the Helmets Hall of Fame, a wall of 26 helmets."></td>
  </tr>
  <tr>
    <td align="center"><sub><b>On Track / Off Track.</b> Pinned while the cut-outs close in from the edges.</sub></td>
    <td align="center"><sub><b>Helmets Hall of Fame.</b> 26 helmets from his McLaren, Mercedes and Ferrari years.</sub></td>
  </tr>
  <tr>
    <td><img src="media/home-store.webp" alt="The store section: Still We Rise."></td>
    <td><img src="media/footer.webp" alt="The footer: Still setting the pace."></td>
  </tr>
</table>

### On Track 

<table>
  <tr>
    <td width="50%"><img src="media/on-track.webp" alt="The On Track page opens with a 3D helmet that flies through the page as it scrolls into the podium count."></td>
    <td width="50%"><img src="media/seasons.webp" alt="Career figures count up, followed by the season-by-season table and the list of race wins."></td>
  </tr>
  <tr>
    <td align="center"><sub><b>The helmet flight.</b> One glTF model, flown through the top of the page by the scroll.</sub></td>
    <td align="center"><sub><b>Career figures and seasons.</b> Counted up from the data layer, never typed in.</sub></td>
  </tr>
</table>

The racing record: starts, wins, podiums, poles and fastest laps, a table of all twenty seasons
with the championship years marked, the wins as a results feed, his junior career from 1995 to
2006, and the season's remaining rounds with a countdown to the next one.

<table>
  <tr>
    <td width="33%"><img src="media/on-track-hero.webp" alt="On Track hero."></td>
    <td width="33%"><img src="media/on-track-highlights.webp" alt="F1 result highlights: a list of race wins with dates and race times."></td>
    <td width="33%"><img src="media/on-track-schedule.webp" alt="The upcoming 2026 schedule."></td>
  </tr>
</table>

### Off Track 

<table>
  <tr>
    <td width="50%"><img src="media/off-track.webp" alt="The Off Track page opens on a profile portrait, then a statement, then the first projects."></td>
    <td width="50%"><img src="media/gallery.webp" alt="The Off Track gallery drifts through Mission 44, fashion and the Met Gala, film and Almave."></td>
  </tr>
  <tr>
    <td align="center"><sub><b>Beyond the circuit.</b> The opening pair of screens.</sub></td>
    <td align="center"><sub><b>Personal projects.</b> A drifting gallery with its captions in step.</sub></td>
  </tr>
</table>

Four projects in the reference's layout: Mission 44, fashion and the Met Gala, *F1: The Movie*,
and Almave. Every fact on the page is third-person site copy with at least one source recorded
beside it in [`src/content/off-track.ts`](src/content/off-track.ts). Nothing on the site is a
quote attributed to him.

### Calendar 

<img src="media/circuits.webp" width="100%" alt="The Calendar's 3D circuit map swaps from Austin to Mexico City to São Paulo. Each circuit is a glowing yellow ribbon that wipes away and redraws under a slowly turning camera.">

The season's 23 rounds, with the circuit of the selected round drawn in 3D: a lit ribbon under a
slowly orbiting camera, its corners numbered, with bloom over the render. Stepping to another
round wipes the ribbon away and draws the next one over two seconds. You can drag it to spin it.

<table>
  <tr>
    <td width="33%"><img src="media/calendar-rounds.webp" alt="The 2026 rounds with results so far."></td>
    <td width="33%"><img src="media/calendar-results.webp" alt="Every Formula 1 season from 2007, opening to each Grand Prix result."></td>
    <td width="33%"><img src="media/calendar-countdown.webp" alt="The countdown to race day."></td>
  </tr>
  <tr>
    <td align="center"><sub>The season so far</sub></td>
    <td align="center"><sub>Every Grand Prix since 2007</sub></td>
    <td align="center"><sub>Countdown to race day</sub></td>
  </tr>
</table>

### Transitions

<img src="media/menu.webp" width="100%" alt="The menu opens over the page, and choosing On Track plays a full-screen red transition with a large 44 before the next page arrives.">

The menu button morphs between its bars and a cross and fills like liquid on hover. A page change
plays one panel out and in: the same panel that serves as the loader on a first visit.

## The stats

<div align="center">

| Starts | Wins | Podiums | Poles | Fastest laps | Points | World titles |
| :----: | :--: | :-----: | :---: | :----------: | :----: | :----------: |
| **397** | **106** | **208** | **104** | **69** | **5,247.5** | **7** |

<sub>Lewis Hamilton's Formula 1 record through the 2026 Singapore Grand Prix (11 October 2026).
Twenty seasons, 2007 to 2026, with McLaren, Mercedes and Ferrari. Titles in 2008, 2014, 2015 and 2017 to 2020.<br>
Source: <a href="https://github.com/jolpica/jolpica-f1">Jolpica-F1</a>, fetched 13 October 2026.</sub>

</div>

That table is a snapshot, and it is the only place these figures are typed. He is still racing,
so the totals move every race weekend. The site never hardcodes them:

```mermaid
flowchart LR
    API["Jolpica-F1 API"] -- "npm run fetch-stats<br>33 requests, cross-checked" --> JSON["career.json<br>397 races, 39 circuits"]
    JSON --> LIVE["live-stats.ts<br>validates and types it,<br>throws on anything malformed"]
    LIVE --> CONFIG["vite.config.ts<br>fills titles and descriptions<br>at build time"]
    LIVE --> PAGES["page modules<br>bind every figure<br>into the page"]
    CONFIG --> HTML["static HTML<br>link previews, crawlers"]
    PAGES --> DOM["what you read"]
```



## Credits

- **[landonorris.com](https://landonorris.com)** is the site this remakes: its structure, its
  sections and its scroll mechanics. Its circuit-outline Rive file is used as is.
- **[Jolpica-F1](https://github.com/jolpica/jolpica-f1)** for the race data.
- **[mnmxmx/fluid-three](https://github.com/mnmxmx/fluid-three)** (MIT): the pointer fluid is a
  port of its stable-fluids solver.
- **[webgl-noise](https://github.com/stegu/webgl-noise)** by Ian McEwan and Stefan Gustavson
  (MIT): the simplex noise in the contour field.
- **[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits)** (MIT): two of the circuit
  outlines.
- **Mona Sans** and **Playfair Display**, each under the SIL Open Font License.

The full notices are in
[`public/assets/THIRD-PARTY-NOTICES.txt`](public/assets/THIRD-PARTY-NOTICES.txt).

Names, logos, trademarks and photographs belong to their owners. This project claims no rights to
them and is not endorsed by anyone it depicts or names.
