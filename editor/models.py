import uuid

from django.db import models
from django.db.models import F, Q

# Values accepted in the .crivo document (format 2.1 additions). Kept here so the CHECK constraints and the API
# validation (editor.services) share one list.
COLOR_MODES = ("rgba", "indexed", "grayscale")
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
LAYER_KINDS = ("image", "group", "tilemap")
TAG_DIRECTIONS = ("forward", "reverse", "pingpong")
MAX_TILE_SIDE = 256
MAX_TILES = 4096


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    fps = models.PositiveSmallIntegerField(default=8)
    format_version = models.PositiveSmallIntegerField(default=2)
    revision = models.PositiveIntegerField(default=1)
    palette = models.JSONField(default=list, blank=True)
    color_mode = models.CharField(max_length=10, default="rgba")
    thumbnail = models.BinaryField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "project"
        ordering = ["-updated_at"]
        indexes = [models.Index(fields=["-updated_at"], name="project_updated_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(width__gte=1, width__lte=1024), name="project_width_valid"),
            models.CheckConstraint(condition=Q(height__gte=1, height__lte=1024), name="project_height_valid"),
            models.CheckConstraint(condition=Q(fps__gte=1, fps__lte=60), name="project_fps_valid"),
            models.CheckConstraint(condition=Q(color_mode__in=COLOR_MODES), name="project_color_mode_valid"),
        ]

    def __str__(self):
        return f"{self.name} ({self.width}x{self.height})"


class Layer(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="layers")
    key = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=80)
    visible = models.BooleanField(default=True)
    opacity = models.PositiveSmallIntegerField(default=100)
    locked = models.BooleanField(default=False)
    blend_mode = models.CharField(max_length=16, default="normal")
    kind = models.CharField(max_length=8, default="image")
    # Key of the group layer that contains this one (same project), or null for a top-level layer.
    parent_key = models.CharField(max_length=40, null=True, blank=True)
    collapsed = models.BooleanField(default=False)
    # Key of the tileset used by a tilemap layer, or null.
    tileset_key = models.CharField(max_length=40, null=True, blank=True)
    reference = models.BooleanField(default=False)

    class Meta:
        db_table = "layer"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="layer_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="layer_position_unique"),
            models.CheckConstraint(condition=Q(opacity__lte=100), name="layer_opacity_valid"),
            models.CheckConstraint(condition=Q(blend_mode__in=BLEND_MODES), name="layer_blend_mode_valid"),
            models.CheckConstraint(condition=Q(kind__in=LAYER_KINDS), name="layer_kind_valid"),
            models.CheckConstraint(condition=Q(parent_key__isnull=True) | ~Q(parent_key=F("key")), name="layer_parent_not_self"),
            models.CheckConstraint(condition=Q(kind="tilemap") | Q(tileset_key__isnull=True), name="layer_tileset_only_tilemap"),
        ]

    def __str__(self):
        return self.name


class Frame(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="frames")
    key = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    duration_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "frame"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="frame_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="frame_position_unique"),
        ]

    def __str__(self):
        return f"Frame {self.position + 1}"


class Cell(models.Model):
    frame = models.ForeignKey(Frame, on_delete=models.CASCADE, related_name="cells")
    layer = models.ForeignKey(Layer, on_delete=models.CASCADE, related_name="cells")
    encoding = models.CharField(max_length=16, default="rle-rgba")
    pixels = models.BinaryField()
    size_bytes = models.PositiveIntegerField()
    # Linked cel: key of the frame (same layer) whose cel this one shares. `pixels` still holds a copy.
    link_frame_key = models.CharField(max_length=40, null=True, blank=True)
    # Tilemap layers: RLE of the Uint32 tile indices (columns x rows). `pixels` still holds the rendered pixels.
    tiles = models.BinaryField(null=True, blank=True)

    class Meta:
        db_table = "cell"
        constraints = [models.UniqueConstraint(fields=["frame", "layer"], name="cell_unique")]


class Tag(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tags")
    key = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=80)
    from_frame_key = models.CharField(max_length=40)
    to_frame_key = models.CharField(max_length=40)
    direction = models.CharField(max_length=8, default="forward")
    repeat = models.PositiveIntegerField(default=0)
    color = models.CharField(max_length=7, default="#000000")

    class Meta:
        db_table = "tag"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="tag_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="tag_position_unique"),
            models.CheckConstraint(condition=Q(direction__in=TAG_DIRECTIONS), name="tag_direction_valid"),
            models.CheckConstraint(condition=Q(repeat__lte=65535), name="tag_repeat_valid"),
            models.CheckConstraint(condition=Q(color__regex=r"^#[0-9a-f]{6}$"), name="tag_color_valid"),
        ]

    def __str__(self):
        return self.name


class Slice(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="slices")
    key = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=80)
    color = models.CharField(max_length=9, default="#0000ff")
    x = models.SmallIntegerField()
    y = models.SmallIntegerField()
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    # 9-slice center and pivot, relative to the slice; all four (or both) are set, or none.
    center_x = models.PositiveSmallIntegerField(null=True, blank=True)
    center_y = models.PositiveSmallIntegerField(null=True, blank=True)
    center_width = models.PositiveSmallIntegerField(null=True, blank=True)
    center_height = models.PositiveSmallIntegerField(null=True, blank=True)
    pivot_x = models.SmallIntegerField(null=True, blank=True)
    pivot_y = models.SmallIntegerField(null=True, blank=True)

    class Meta:
        db_table = "slice"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="slice_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="slice_position_unique"),
            models.CheckConstraint(condition=Q(x__gte=-1024, x__lte=1024, y__gte=-1024, y__lte=1024), name="slice_origin_valid"),
            models.CheckConstraint(condition=Q(width__gte=1, width__lte=1024), name="slice_width_valid"),
            models.CheckConstraint(condition=Q(height__gte=1, height__lte=1024), name="slice_height_valid"),
            models.CheckConstraint(condition=Q(color__regex=r"^#[0-9a-f]{6}([0-9a-f]{2})?$"), name="slice_color_valid"),
            models.CheckConstraint(
                condition=Q(center_x__isnull=True, center_y__isnull=True, center_width__isnull=True, center_height__isnull=True)
                | Q(center_x__isnull=False, center_y__isnull=False, center_width__isnull=False, center_height__isnull=False),
                name="slice_center_complete",
            ),
            models.CheckConstraint(
                condition=Q(pivot_x__isnull=True, pivot_y__isnull=True) | Q(pivot_x__isnull=False, pivot_y__isnull=False),
                name="slice_pivot_complete",
            ),
        ]

    def __str__(self):
        return self.name


class Tileset(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="tilesets")
    key = models.CharField(max_length=40)
    position = models.PositiveSmallIntegerField()
    name = models.CharField(max_length=80)
    tile_width = models.PositiveSmallIntegerField()
    tile_height = models.PositiveSmallIntegerField()
    tile_count = models.PositiveSmallIntegerField()
    # RLE (same encoding as Cell.pixels) of every tile, concatenated in order; tile 0 is the empty tile.
    tiles = models.BinaryField()

    class Meta:
        db_table = "tileset"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="tileset_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="tileset_position_unique"),
            models.CheckConstraint(condition=Q(tile_width__gte=1, tile_width__lte=MAX_TILE_SIDE), name="tileset_tile_width_valid"),
            models.CheckConstraint(condition=Q(tile_height__gte=1, tile_height__lte=MAX_TILE_SIDE), name="tileset_tile_height_valid"),
            models.CheckConstraint(condition=Q(tile_count__gte=1, tile_count__lte=MAX_TILES), name="tileset_tile_count_valid"),
        ]

    def __str__(self):
        return self.name


class Revision(models.Model):
    project = models.ForeignKey(Project, on_delete=models.CASCADE, related_name="revisions")
    number = models.PositiveIntegerField()
    name = models.CharField(max_length=120)
    content = models.BinaryField()
    size_bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "revision"
        ordering = ["project", "-number"]
        constraints = [models.UniqueConstraint(fields=["project", "number"], name="revision_number_unique")]


class Palette(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=60, unique=True, null=True, blank=True)
    name = models.CharField(max_length=80)
    description = models.CharField(max_length=240, blank=True, default="")
    preset = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "palette"
        ordering = ["-preset", "name"]

    def __str__(self):
        return self.name


class PaletteColor(models.Model):
    palette = models.ForeignKey(Palette, on_delete=models.CASCADE, related_name="colors")
    position = models.PositiveSmallIntegerField()
    hex = models.CharField(max_length=9)

    class Meta:
        db_table = "palette_color"
        ordering = ["palette", "position"]
        constraints = [
            models.UniqueConstraint(fields=["palette", "position"], name="palette_color_position_unique"),
            models.CheckConstraint(condition=Q(hex__regex=r"^#[0-9a-f]{6}([0-9a-f]{2})?$"), name="palette_color_hex_valid"),
        ]
