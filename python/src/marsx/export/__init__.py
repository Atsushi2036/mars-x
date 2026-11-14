"""Export a MARS-X scenario to higher-fidelity simulators (Gazebo, Isaac Sim/Lab) and the web.

Package contents (fixed paths): terrain.tif (GeoTIFF, metres), terrain.glb, terrain.obj/.mtl, terrain_texture.jpg,
scenario.json (scenario/1), world.sdf (fixed template, no plugins), manifest.json (sha256 of every file),
ATTRIBUTION.txt, README.txt. See ``python -m marsx.export --help``.
"""
