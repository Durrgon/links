"""Render the avatar frame in Blender, lit, from the masks in art/frame-masks/.

Builds a flat plane whose material is stacked from the masks the way fill layers
would be in Substance Painter: textured stone, carved (sunken) outlines, and runes
in metal or paint, raised or sunk. A top-down orthographic camera with a sun lamp
and one of Blender's built-in HDRIs (for metal reflections) renders a PNG with a
transparent background, framed exactly like images/avatar-frame*.svg, so it uses
the same CSS sizes.

Make the masks first:   python scripts/make_avatar_frame.py --masks
Then, from the repo root:
    "G:/SteamLibrary/steamapps/common/Blender/blender.exe" -b -P scripts/render_frame_blender.py -- [options]
(written for Blender 5.3, the Steam version)

Options (all optional):
    --variant plain|head|border   which frame (default plain); border = scripts/make_rune_border.py --masks
    --runes gold|silver|bronze|copper|iron|red   rune material (default gold)
    --rune-height 1.0             raised runes > 0, carved-in runes < 0
    --rune-roughness 0.45         metal roughness (default per metal; rougher reads brighter small)
    --gold-edges                  the band's edge lines as raised metal too (not carved grooves)
    --stone slate|granite|sandstone|basalt|blackslate   stone colours (default slate)
    --hdri studio|forest|city|courtyard|interior|night|sunrise|sunset (default studio)
    --sun-azimuth 135             degrees, 0 = from the right, 90 = from the top
    --sun-elevation 35            degrees above the ring
    --sun-strength 3.0
    --size 1024                   output width and height in pixels
    --samples 96
    --out art/renders/<variant>-<runes>.png
"""
import argparse
import math
import os
import sys

import bpy

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

METALS = {  # base colour (linear), metallic, roughness
    "gold": ((1.00, 0.71, 0.29), 1.0, 0.28),
    "silver": ((0.95, 0.93, 0.88), 1.0, 0.25),
    "bronze": ((0.80, 0.50, 0.25), 1.0, 0.35),
    "copper": ((0.95, 0.55, 0.40), 1.0, 0.30),
    "iron": ((0.53, 0.51, 0.49), 1.0, 0.45),
    "red": ((0.45, 0.03, 0.02), 0.0, 0.65),   # painted, like the old stones
}
STONES = {  # dark, light (linear), roughness
    "slate": ((0.10, 0.11, 0.13), (0.30, 0.32, 0.35), 0.80),
    "granite": ((0.20, 0.20, 0.20), (0.55, 0.54, 0.52), 0.75),
    "sandstone": ((0.35, 0.22, 0.12), (0.70, 0.55, 0.38), 0.90),
    "basalt": ((0.03, 0.03, 0.035), (0.12, 0.12, 0.13), 0.70),
    "blackslate": ((0.0015, 0.0017, 0.0022), (0.011, 0.012, 0.015), 0.75),   # near-black, for silver
}


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--variant", default="plain", choices=["plain", "head", "border"])
    p.add_argument("--runes", default="gold", choices=list(METALS))
    p.add_argument("--rune-height", type=float, default=1.0)
    p.add_argument("--rune-roughness", type=float, help="override the metal's roughness (rougher = brighter when small)")
    p.add_argument("--gold-edges", action="store_true",
                   help="the band's edge lines as raised metal like the runes, not carved grooves")
    p.add_argument("--stone", default="slate", choices=list(STONES))
    p.add_argument("--hdri", default="studio")
    p.add_argument("--sun-azimuth", type=float, default=135)
    p.add_argument("--sun-elevation", type=float, default=35)
    p.add_argument("--sun-strength", type=float, default=3.0)
    p.add_argument("--size", type=int, default=1024)
    p.add_argument("--samples", type=int, default=96)
    p.add_argument("--out")
    return p.parse_args(argv)


def mask(nodes, links, uv, path, x, y):
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    tex.image.colorspace_settings.name = "Non-Color"
    tex.interpolation = "Cubic"
    tex.extension = "CLIP"
    tex.location = (x, y)
    links.new(uv.outputs["UV"], tex.inputs["Vector"])
    return tex.outputs["Color"]


def math_node(nodes, links, op, a, b, x, y):
    n = nodes.new("ShaderNodeMath")
    n.operation = op
    n.location = (x, y)
    for i, v in enumerate((a, b)):
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            links.new(v, n.inputs[i])
    return n.outputs[0]


def principled(nodes, colour, metallic, roughness, x, y):
    b = nodes.new("ShaderNodeBsdfPrincipled")
    b.location = (x, y)
    if isinstance(colour, tuple):
        b.inputs["Base Color"].default_value = (*colour, 1)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    return b


def build_material(args):
    masks = os.path.join(ROOT, "art", "frame-masks")
    m = bpy.data.materials.new("frame")
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    nodes.clear()

    uv = nodes.new("ShaderNodeTexCoord")
    uv.location = (-1400, 0)
    get = lambda name, y: mask(nodes, links, uv, os.path.join(masks, f"{args.variant}-{name}.png"), -1100, y)
    shape, lines, runes = get("shape", 400), get("lines", 0), get("runes", -400)
    if args.gold_edges:
        # <variant>-edges.png (the band's edge lines without the grooves round the runes); the
        # ring and serpent have no rune grooves, so their lines mask is all edges
        name = "edges" if os.path.exists(os.path.join(masks, f"{args.variant}-edges.png")) else "lines"
        edges = get(name, 800)
        runes = math_node(nodes, links, "MAXIMUM", runes, edges, -950, -500)          # edges are metal
        lines = math_node(nodes, links, "MULTIPLY", lines,
                          math_node(nodes, links, "SUBTRACT", 1.0, edges, -950, 650), -850, 600)   # not grooves

    # Stone: two-tone grain, plus a little of it as surface relief. A <variant>-grain.png
    # (the border has one, stitched so its repeats join up) replaces Blender's noise.
    grain_map = os.path.join(masks, f"{args.variant}-grain.png")
    if os.path.exists(grain_map):
        grain = mask(nodes, links, uv, grain_map, -1100, 800)
    else:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.location = (-1100, 800)
        noise.inputs["Scale"].default_value = 60
        noise.inputs["Detail"].default_value = 10
        noise.inputs["Roughness"].default_value = 0.6
        links.new(uv.outputs["Object"], noise.inputs["Vector"])
        grain = noise.outputs["Fac"]
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.location = (-850, 800)
    dark, light, stone_rough = STONES[args.stone]
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.35, 0.7
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = (*dark, 1), (*light, 1)
    links.new(grain, ramp.inputs["Fac"])

    # Height: stone grain, carved lines sunk in, runes raised (or sunk).
    h = math_node(nodes, links, "MULTIPLY", grain, 0.15, -600, 300)
    h = math_node(nodes, links, "SUBTRACT", h, math_node(nodes, links, "MULTIPLY", lines, 0.7, -800, 100), -450, 250)
    h = math_node(nodes, links, "ADD", h, math_node(nodes, links, "MULTIPLY", runes, args.rune_height, -800, -300), -300, 200)
    bump = nodes.new("ShaderNodeBump")
    bump.location = (-150, 200)
    bump.inputs["Distance"].default_value = 0.004
    bump.inputs["Strength"].default_value = 1.0
    links.new(h, bump.inputs["Height"])

    stone = principled(nodes, None, 0.0, stone_rough, 100, 700)
    links.new(ramp.outputs["Color"], stone.inputs["Base Color"])
    groove = principled(nodes, tuple(c * 0.35 for c in dark), 0.0, 0.95, 100, 200)
    colour, metallic, rough = METALS[args.runes]
    if args.rune_roughness is not None:
        rough = args.rune_roughness
    rune = principled(nodes, colour, metallic, rough, 100, -300)
    for b in (stone, groove, rune):
        links.new(bump.outputs["Normal"], b.inputs["Normal"])

    mix_lines = nodes.new("ShaderNodeMixShader")
    mix_lines.location = (450, 400)
    links.new(lines, mix_lines.inputs["Fac"])
    links.new(stone.outputs[0], mix_lines.inputs[1])
    links.new(groove.outputs[0], mix_lines.inputs[2])
    mix_runes = nodes.new("ShaderNodeMixShader")
    mix_runes.location = (650, 200)
    links.new(runes, mix_runes.inputs["Fac"])
    links.new(mix_lines.outputs[0], mix_runes.inputs[1])
    links.new(rune.outputs[0], mix_runes.inputs[2])
    clear = nodes.new("ShaderNodeBsdfTransparent")
    clear.location = (650, 500)
    cut = nodes.new("ShaderNodeMixShader")
    cut.location = (850, 300)
    links.new(shape, cut.inputs["Fac"])
    links.new(clear.outputs[0], cut.inputs[1])
    links.new(mix_runes.outputs[0], cut.inputs[2])
    out = nodes.new("ShaderNodeOutputMaterial")
    out.location = (1050, 300)
    links.new(cut.outputs[0], out.inputs["Surface"])
    if hasattr(m, "blend_method"):   # gone in newer Blender; Cycles needs nothing here
        try:
            m.blend_method = "BLEND"
        except (AttributeError, TypeError):
            pass
    return m


def build_world(args):
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    env = nodes.new("ShaderNodeTexEnvironment")
    folder = bpy.utils.system_resource("DATAFILES", path="studiolights/world")
    path = os.path.join(folder, f"{args.hdri}.exr")
    env.image = bpy.data.images.load(path)
    links.new(env.outputs["Color"], nodes["Background"].inputs["Color"])
    nodes["Background"].inputs["Strength"].default_value = 1.0


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    bpy.ops.mesh.primitive_plane_add(size=2)
    bpy.context.object.data.materials.append(build_material(args))
    build_world(args)

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = args.sun_strength
    sun_data.angle = math.radians(3)
    sun = bpy.data.objects.new("sun", sun_data)
    az, el = math.radians(args.sun_azimuth), math.radians(args.sun_elevation)
    # a sun shines down its local -Z; tilt by (90 - elevation) about Y, then turn to the azimuth,
    # so the light comes from (azimuth, elevation) toward the ring
    sun.rotation_euler = (0, math.pi / 2 - el, az)
    scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 2
    cam = bpy.data.objects.new("cam", cam_data)
    cam.location = (0, 0, 5)
    scene.collection.objects.link(cam)
    scene.camera = cam

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    out = args.out or os.path.join(ROOT, "art", "renders", f"{args.variant}-{args.runes}.png")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    scene.render.filepath = os.path.abspath(out)
    bpy.ops.render.render(write_still=True)
    print("Wrote", out)


main()
