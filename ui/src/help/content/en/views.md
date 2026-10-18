# 3D Nucleus and 2D map

Two ways of looking at the team knowledge as a constellation: every memory is a star, links join related memories.

## Links {#links}

Two memories are linked when they share **tags** (weighted: rare tags count more), when they are **close in meaning** (similar vectors) or when **dreaming** linked them explicitly. The most linked and most used memories are bigger stars.

## The Nucleus {#nucleus}

The home page: a navigable holographic sphere.
- **Moving around**: drag to rotate, wheel to zoom, click a star to fly to it and read it. After 20 seconds of inactivity the sphere rotates by itself.
- **Guided exploration**: the camera flies from one topic to the next (the most common tags), with a caption.
- **Light up a topic**: relevant memories light up and the camera flies to them.
- **Colours**: holographic (intensity by activation), by author or by kind; in the last two the legend is clickable and isolates an entry.
- **Roots**: at the centre of the sphere, with a white ring (red if to review); "◆ Roots" isolates them. With many Roots the core widens, and beyond about twenty (e.g. an imported vault) the Roots spread through the shell like the other memories; the more there are, the smaller and fainter each one is, and those outside the filter, search or tour stop stay a dot with no ring. This keeps them distinguishable.

## The 2D map {#map}

The same constellation on a plane, for focused analysis: colours by author or kind, clickable legend, search that lights up, labels that appear as you zoom in. Roots are diamonds. Clicking a node opens its details over the map, at the top right.

## Galaxies {#galaxies}

With many memories (over 250) one star per memory becomes an indistinct field. The Nucleus and the 2D map then start from the **overview**: one cluster (or circle) per **galaxy**, a group of memories on the same topic, with its name and number of memories.
- **Enter**: click a galaxy; "◀ All galaxies" goes back. Inside a very large galaxy at most 600 stars are drawn: the Roots, the lit ones and the most active (find the others with search).
- **Search and filter**: with few results (up to 250) only those are shown, from every galaxy; with many, the galaxies containing them light up, with the number of results.
- **Guided exploration**: in the overview it flies from galaxy to galaxy; inside a galaxy, across its topics.
- **Cluster with a cyan ring**: the galaxy contains Roots. "unlinked" gathers the memories not connected to any other.

**How it works behind the scenes.** The daemon groups memories with the **Louvain** algorithm over the constellation's links (shared tags, meaning, dreaming): each memory moves to the community that makes groups most "compact", then groups are merged and the process repeats. The resolution is chosen automatically: the lowest that produces no giant galaxy (no more than 10% of the memories). Tiny communities merge into a neighbour, and there are at most 40 galaxies. The **name** is the most characteristic tags: frequent in the galaxy and rare in the rest of the team. The computation is deterministic (same memories, same galaxies on every PC) and runs in the background after each update (about half a second with 5,000 memories); meanwhile the views use the previous version. Semantic neighbours are saved in the local index (`view.db`) and re-read at startup instead of being recomputed.

## Performance {#performance}

The Nucleus uses WebGL (three.js) and is loaded only when needed. On a PC with weak graphics, `#/?bloom=0` in the address removes the glow.
