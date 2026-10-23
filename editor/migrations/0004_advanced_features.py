"""Crivo 2.1.0: advanced document features (groups, blend modes, tags, tilemaps, slices, color modes).

Formerly 0004_aseprite_features: `replaces` keeps databases that already applied it under the old name in sync.

Adds, without touching existing rows (every new column is nullable or has a default, so existing projects read
exactly as before and the API still returns their 2.0 documents unchanged):

- project.color_mode ('rgba' | 'indexed' | 'grayscale', default 'rgba');
- layer.blend_mode (default 'normal'), kind ('image' | 'group' | 'tilemap', default 'image'), parent_key (key of the
  containing group layer, null at the top level), collapsed, tileset_key (tilemap layers only) and reference;
- cell.link_frame_key (linked cel: frame key of the source cel of the same layer) and cell.tiles (RLE of the tile
  indices of a tilemap cel);
- new tables tag, slice and tileset (one row per item, ordered by position, identified by key within the project).

Valid values are enforced with CHECK constraints in the style of 0003 (enumerations, sizes, colors and the
all-or-nothing slice center and pivot).
"""

import django.db.models.deletion
from django.db import migrations, models

BLEND_MODES = (
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "addition",
    "subtract",
    "divide",
)


class Migration(migrations.Migration):
    replaces = [("editor", "0004_aseprite_features")]
    dependencies = [("editor", "0003_english_schema")]

    operations = [
        # 1. New columns on existing tables (defaults or NULL keep every existing row valid).
        migrations.AddField(model_name="project", name="color_mode", field=models.CharField(default="rgba", max_length=10)),
        migrations.AddField(model_name="layer", name="blend_mode", field=models.CharField(default="normal", max_length=16)),
        migrations.AddField(model_name="layer", name="kind", field=models.CharField(default="image", max_length=8)),
        migrations.AddField(model_name="layer", name="parent_key", field=models.CharField(blank=True, max_length=40, null=True)),
        migrations.AddField(model_name="layer", name="collapsed", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="layer", name="tileset_key", field=models.CharField(blank=True, max_length=40, null=True)),
        migrations.AddField(model_name="layer", name="reference", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="cell", name="link_frame_key", field=models.CharField(blank=True, max_length=40, null=True)),
        migrations.AddField(model_name="cell", name="tiles", field=models.BinaryField(blank=True, null=True)),
        # 2. New tables.
        migrations.CreateModel(
            name="Tag",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tags", to="editor.project")),
                ("key", models.CharField(max_length=40)),
                ("position", models.PositiveSmallIntegerField()),
                ("name", models.CharField(max_length=80)),
                ("from_frame_key", models.CharField(max_length=40)),
                ("to_frame_key", models.CharField(max_length=40)),
                ("direction", models.CharField(default="forward", max_length=8)),
                ("repeat", models.PositiveIntegerField(default=0)),
                ("color", models.CharField(default="#000000", max_length=7)),
            ],
            options={"db_table": "tag", "ordering": ["project", "position"]},
        ),
        migrations.CreateModel(
            name="Slice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="slices", to="editor.project")),
                ("key", models.CharField(max_length=40)),
                ("position", models.PositiveSmallIntegerField()),
                ("name", models.CharField(max_length=80)),
                ("color", models.CharField(default="#0000ff", max_length=9)),
                ("x", models.SmallIntegerField()),
                ("y", models.SmallIntegerField()),
                ("width", models.PositiveSmallIntegerField()),
                ("height", models.PositiveSmallIntegerField()),
                ("center_x", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("center_y", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("center_width", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("center_height", models.PositiveSmallIntegerField(blank=True, null=True)),
                ("pivot_x", models.SmallIntegerField(blank=True, null=True)),
                ("pivot_y", models.SmallIntegerField(blank=True, null=True)),
            ],
            options={"db_table": "slice", "ordering": ["project", "position"]},
        ),
        migrations.CreateModel(
            name="Tileset",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("project", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="tilesets", to="editor.project")),
                ("key", models.CharField(max_length=40)),
                ("position", models.PositiveSmallIntegerField()),
                ("name", models.CharField(max_length=80)),
                ("tile_width", models.PositiveSmallIntegerField()),
                ("tile_height", models.PositiveSmallIntegerField()),
                ("tile_count", models.PositiveSmallIntegerField()),
                ("tiles", models.BinaryField()),
            ],
            options={"db_table": "tileset", "ordering": ["project", "position"]},
        ),
        # 3. Constraints.
        migrations.AddConstraint(
            model_name="project",
            constraint=models.CheckConstraint(condition=models.Q(("color_mode__in", ("rgba", "indexed", "grayscale"))), name="project_color_mode_valid"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.CheckConstraint(condition=models.Q(("blend_mode__in", BLEND_MODES)), name="layer_blend_mode_valid"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.CheckConstraint(condition=models.Q(("kind__in", ("image", "group", "tilemap"))), name="layer_kind_valid"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.CheckConstraint(
                condition=models.Q(("parent_key__isnull", True), models.Q(("parent_key", models.F("key")), _negated=True), _connector="OR"),
                name="layer_parent_not_self",
            ),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind", "tilemap"), ("tileset_key__isnull", True), _connector="OR"), name="layer_tileset_only_tilemap"
            ),
        ),
        migrations.AddConstraint(model_name="tag", constraint=models.UniqueConstraint(fields=("project", "key"), name="tag_key_unique")),
        migrations.AddConstraint(model_name="tag", constraint=models.UniqueConstraint(fields=("project", "position"), name="tag_position_unique")),
        migrations.AddConstraint(
            model_name="tag",
            constraint=models.CheckConstraint(condition=models.Q(("direction__in", ("forward", "reverse", "pingpong"))), name="tag_direction_valid"),
        ),
        migrations.AddConstraint(model_name="tag", constraint=models.CheckConstraint(condition=models.Q(("repeat__lte", 65535)), name="tag_repeat_valid")),
        migrations.AddConstraint(
            model_name="tag", constraint=models.CheckConstraint(condition=models.Q(("color__regex", "^#[0-9a-f]{6}$")), name="tag_color_valid")
        ),
        migrations.AddConstraint(model_name="slice", constraint=models.UniqueConstraint(fields=("project", "key"), name="slice_key_unique")),
        migrations.AddConstraint(model_name="slice", constraint=models.UniqueConstraint(fields=("project", "position"), name="slice_position_unique")),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(
                condition=models.Q(("x__gte", -1024), ("x__lte", 1024), ("y__gte", -1024), ("y__lte", 1024)), name="slice_origin_valid"
            ),
        ),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(condition=models.Q(("width__gte", 1), ("width__lte", 1024)), name="slice_width_valid"),
        ),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(condition=models.Q(("height__gte", 1), ("height__lte", 1024)), name="slice_height_valid"),
        ),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(condition=models.Q(("color__regex", "^#[0-9a-f]{6}([0-9a-f]{2})?$")), name="slice_color_valid"),
        ),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("center_height__isnull", True), ("center_width__isnull", True), ("center_x__isnull", True), ("center_y__isnull", True)),
                    models.Q(("center_height__isnull", False), ("center_width__isnull", False), ("center_x__isnull", False), ("center_y__isnull", False)),
                    _connector="OR",
                ),
                name="slice_center_complete",
            ),
        ),
        migrations.AddConstraint(
            model_name="slice",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("pivot_x__isnull", True), ("pivot_y__isnull", True)),
                    models.Q(("pivot_x__isnull", False), ("pivot_y__isnull", False)),
                    _connector="OR",
                ),
                name="slice_pivot_complete",
            ),
        ),
        migrations.AddConstraint(model_name="tileset", constraint=models.UniqueConstraint(fields=("project", "key"), name="tileset_key_unique")),
        migrations.AddConstraint(
            model_name="tileset", constraint=models.UniqueConstraint(fields=("project", "position"), name="tileset_position_unique")
        ),
        migrations.AddConstraint(
            model_name="tileset",
            constraint=models.CheckConstraint(condition=models.Q(("tile_width__gte", 1), ("tile_width__lte", 256)), name="tileset_tile_width_valid"),
        ),
        migrations.AddConstraint(
            model_name="tileset",
            constraint=models.CheckConstraint(condition=models.Q(("tile_height__gte", 1), ("tile_height__lte", 256)), name="tileset_tile_height_valid"),
        ),
        migrations.AddConstraint(
            model_name="tileset",
            constraint=models.CheckConstraint(condition=models.Q(("tile_count__gte", 1), ("tile_count__lte", 4096)), name="tileset_tile_count_valid"),
        ),
    ]
