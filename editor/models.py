import uuid

from django.db import models
from django.db.models import Q


class Project(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120)
    width = models.PositiveSmallIntegerField()
    height = models.PositiveSmallIntegerField()
    fps = models.PositiveSmallIntegerField(default=8)
    format_version = models.PositiveSmallIntegerField(default=2)
    revision = models.PositiveIntegerField(default=1)
    palette = models.JSONField(default=list, blank=True)
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

    class Meta:
        db_table = "layer"
        ordering = ["project", "position"]
        constraints = [
            models.UniqueConstraint(fields=["project", "key"], name="layer_key_unique"),
            models.UniqueConstraint(fields=["project", "position"], name="layer_position_unique"),
            models.CheckConstraint(condition=Q(opacity__lte=100), name="layer_opacity_valid"),
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

    class Meta:
        db_table = "cell"
        constraints = [models.UniqueConstraint(fields=["frame", "layer"], name="cell_unique")]


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
