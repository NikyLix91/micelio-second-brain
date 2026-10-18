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

## Performance {#performance}

The Nucleus uses WebGL (three.js) and is loaded only when needed. On a PC with weak graphics, `#/?bloom=0` in the address removes the glow.
