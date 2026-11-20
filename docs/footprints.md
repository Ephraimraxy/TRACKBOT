# 3D houses from open building footprints

OpenStreetMap has few buildings mapped in Keffi and Masaka, so many houses show flat. Open datasets cover whole Nigerian
towns with machine-detected building outlines. This turns one into a file the map stands up in 3D.

1. Download footprints for your area (free): Google Open Buildings or Microsoft building footprints (Nigeria). Both ask for
   attribution: keep their licence text with your site.
2. Cut your town out (needs Node and this repository, on your own computer):
   `npx tsx scripts/build-footprints.ts --in nigeria.geojsonl --bbox 7.82,8.80,7.93,8.92 --out public/data/keffi-buildings.geojson`
   It keeps buildings inside the box, drops anything under 15 m² or over 5,000 m², gives each a height (the data's own, else 5 m)
   and writes a compact file. It prints how many it kept.
3. Commit the file (check its size first; very large towns should be split) and set `NEXT_PUBLIC_BUILDINGS_URL=/data/keffi-buildings.geojson`
   in Railway, then redeploy.

How it behaves: the live map, the delivery-address map and the checkout pin map add a 3D layer from that file from zoom 15. The
red "customer's building" highlight also uses it. Without the variable nothing changes.

## Limits
- Not tested against real Google or Microsoft data: the script and layer were tested with synthetic files only. Open the map over Keffi and check that houses line up with the pictures.
- The outlines are machine-made: some are shifted a few metres or merge neighbouring houses, and heights are a guess (5 m by default).
- Where OpenStreetMap also has a building, both are drawn and may overlap; the footprint layer is slightly lighter in colour.
- No attribution is added to the map automatically: add the dataset's credit to the About page or the map credits.
