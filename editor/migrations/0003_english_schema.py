"""Crivo 2.0.0: English schema.

Renames every model, table, column, related name, constraint and index from the 1.x Portuguese names to English,
keeping all rows. Only renames are used for tables and columns (RenameModel + AlterModelTable + RenameField), so
no data is copied. Constraints and the index are dropped first, while they still refer to the old field names, and
recreated with English names at the end (Django has no operation that renames a constraint). Then every existing
project is marked as format version 2 (the API now always returns version 2 documents), and on PostgreSQL the names
that were generated from the 1.x table and column names (primary keys, checks, indexes, sequences) are renamed too.

Revisions stored before 2.0.0 keep their version 1 document in `content`; editor.services.upgrade_document converts
them when they are restored.
"""

import re

import django.db.models.deletion
from django.db import migrations, models


def set_format_version_2(apps, schema_editor):
    apps.get_model("editor", "Project").objects.update(format_version=2)


def set_format_version_1(apps, schema_editor):
    apps.get_model("editor", "Project").objects.update(format_version=1)


# PostgreSQL keeps the names it (or Django) generated in 0001 from the 1.x table and column names: primary keys,
# the "column >= 0" checks of positive integer fields, foreign key indexes, the slug unique key and its LIKE index,
# and identity sequences. Nothing refers to them by name, but they are renamed too so the whole schema reads in
# English. SQLite needs nothing: it rebuilds the tables during this migration, which regenerates those names.
# new table: (1.x table, {1.x column: new column})
GENERATED_NAMES = {
    "project": (
        "projeto",
        {
            "nome": "name",
            "largura": "width",
            "altura": "height",
            "versao_formato": "format_version",
            "revisao": "revision",
            "paleta": "palette",
            "miniatura": "thumbnail",
            "criado_em": "created_at",
            "atualizado_em": "updated_at",
        },
    ),
    "layer": (
        "camada",
        {
            "projeto_id": "project_id",
            "chave": "key",
            "posicao": "position",
            "nome": "name",
            "visivel": "visible",
            "opacidade": "opacity",
            "bloqueada": "locked",
        },
    ),
    "frame": ("quadro", {"projeto_id": "project_id", "chave": "key", "posicao": "position", "duracao_ms": "duration_ms"}),
    "cell": ("celula", {"quadro_id": "frame_id", "camada_id": "layer_id", "formato": "encoding", "tamanho_bytes": "size_bytes"}),
    "revision": (
        "revisao",
        {"projeto_id": "project_id", "numero": "number", "nome": "name", "conteudo": "content", "tamanho_bytes": "size_bytes", "criado_em": "created_at"},
    ),
    "palette": ("paleta", {"nome": "name", "descricao": "description", "predefinida": "preset", "criado_em": "created_at", "atualizado_em": "updated_at"}),
    "palette_color": ("cor_paleta", {"paleta_id": "palette_id", "posicao": "position"}),
}

# Only these shapes are generated names; explicit ones (*_unique, *_valid, *_idx, *_fk_*) are handled by the operations.
GENERATED_SUFFIX = re.compile(r"^(pkey|id_seq|[a-z0-9_]+_check|[a-z0-9_]+_key|[a-z0-9_]+_[0-9a-f]{8}(_like)?)$")


def _translated_name(name, old_prefix, new_prefix, columns):
    if not name.startswith(old_prefix + "_"):
        return None
    rest = name[len(old_prefix) + 1 :]
    if "_fk_" in rest or not GENERATED_SUFFIX.match(rest):
        return None
    for old_column in sorted(columns, key=len, reverse=True):
        if rest == old_column or rest.startswith(old_column + "_"):
            rest = columns[old_column] + rest[len(old_column) :]
            break
    return f"{new_prefix}_{rest}"


def _rename_generated_names(schema_editor, forwards):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    quote = schema_editor.quote_name
    # This operation is the last one, so in both directions the tables have their English names when it runs.
    for table, (old_table, columns) in GENERATED_NAMES.items():
        if forwards:
            old_prefix, new_prefix, column_map = old_table, table, columns
        else:
            old_prefix, new_prefix, column_map = table, old_table, {new: old for old, new in columns.items()}
        with connection.cursor() as cursor:
            cursor.execute("SELECT conname FROM pg_constraint WHERE conrelid = %s::regclass", [table])
            for (name,) in cursor.fetchall():
                new_name = _translated_name(name, old_prefix, new_prefix, column_map)
                if new_name:
                    schema_editor.execute(f"ALTER TABLE {quote(table)} RENAME CONSTRAINT {quote(name)} TO {quote(new_name)}")
            # Indexes behind a primary key or unique constraint were renamed together with the constraint above.
            cursor.execute("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = %s", [table])
            for (name,) in cursor.fetchall():
                new_name = _translated_name(name, old_prefix, new_prefix, column_map)
                if new_name:
                    schema_editor.execute(f"ALTER INDEX {quote(name)} RENAME TO {quote(new_name)}")
            cursor.execute("SELECT pg_get_serial_sequence(%s, 'id')", [table])
            sequence = cursor.fetchone()[0]
            if sequence:
                name = sequence.rsplit(".", 1)[-1].strip('"')
                new_name = _translated_name(name, old_prefix, new_prefix, column_map)
                if new_name:
                    schema_editor.execute(f"ALTER SEQUENCE {quote(name)} RENAME TO {quote(new_name)}")


def rename_generated_names(apps, schema_editor):
    _rename_generated_names(schema_editor, forwards=True)


def restore_generated_names(apps, schema_editor):
    _rename_generated_names(schema_editor, forwards=False)


class Migration(migrations.Migration):
    dependencies = [("editor", "0002_paletas_predefinidas")]

    operations = [
        # 1. Drop the Portuguese-named index and constraints while they still match the old field names.
        migrations.RemoveIndex(model_name="projeto", name="projeto_atualizado_idx"),
        migrations.RemoveConstraint(model_name="projeto", name="projeto_largura_valida"),
        migrations.RemoveConstraint(model_name="projeto", name="projeto_altura_valida"),
        migrations.RemoveConstraint(model_name="projeto", name="projeto_fps_valido"),
        migrations.RemoveConstraint(model_name="camada", name="camada_chave_unica"),
        migrations.RemoveConstraint(model_name="camada", name="camada_posicao_unica"),
        migrations.RemoveConstraint(model_name="camada", name="camada_opacidade_valida"),
        migrations.RemoveConstraint(model_name="quadro", name="quadro_chave_unica"),
        migrations.RemoveConstraint(model_name="quadro", name="quadro_posicao_unica"),
        migrations.RemoveConstraint(model_name="celula", name="celula_unica"),
        migrations.RemoveConstraint(model_name="revisao", name="revisao_numero_unico"),
        migrations.RemoveConstraint(model_name="corpaleta", name="cor_posicao_unica"),
        migrations.RemoveConstraint(model_name="corpaleta", name="cor_hex_valido"),
        # 2. Models and tables.
        migrations.RenameModel(old_name="Projeto", new_name="Project"),
        migrations.RenameModel(old_name="Camada", new_name="Layer"),
        migrations.RenameModel(old_name="Quadro", new_name="Frame"),
        migrations.RenameModel(old_name="Celula", new_name="Cell"),
        migrations.RenameModel(old_name="Revisao", new_name="Revision"),
        migrations.RenameModel(old_name="Paleta", new_name="Palette"),
        migrations.RenameModel(old_name="CorPaleta", new_name="PaletteColor"),
        migrations.AlterModelTable(name="project", table="project"),
        migrations.AlterModelTable(name="layer", table="layer"),
        migrations.AlterModelTable(name="frame", table="frame"),
        migrations.AlterModelTable(name="cell", table="cell"),
        migrations.AlterModelTable(name="revision", table="revision"),
        migrations.AlterModelTable(name="palette", table="palette"),
        migrations.AlterModelTable(name="palettecolor", table="palette_color"),
        # 3. Columns.
        migrations.RenameField(model_name="project", old_name="nome", new_name="name"),
        migrations.RenameField(model_name="project", old_name="largura", new_name="width"),
        migrations.RenameField(model_name="project", old_name="altura", new_name="height"),
        migrations.RenameField(model_name="project", old_name="versao_formato", new_name="format_version"),
        migrations.RenameField(model_name="project", old_name="revisao", new_name="revision"),
        migrations.RenameField(model_name="project", old_name="paleta", new_name="palette"),
        migrations.RenameField(model_name="project", old_name="miniatura", new_name="thumbnail"),
        migrations.RenameField(model_name="project", old_name="criado_em", new_name="created_at"),
        migrations.RenameField(model_name="project", old_name="atualizado_em", new_name="updated_at"),
        migrations.RenameField(model_name="layer", old_name="projeto", new_name="project"),
        migrations.RenameField(model_name="layer", old_name="chave", new_name="key"),
        migrations.RenameField(model_name="layer", old_name="posicao", new_name="position"),
        migrations.RenameField(model_name="layer", old_name="nome", new_name="name"),
        migrations.RenameField(model_name="layer", old_name="visivel", new_name="visible"),
        migrations.RenameField(model_name="layer", old_name="opacidade", new_name="opacity"),
        migrations.RenameField(model_name="layer", old_name="bloqueada", new_name="locked"),
        migrations.RenameField(model_name="frame", old_name="projeto", new_name="project"),
        migrations.RenameField(model_name="frame", old_name="chave", new_name="key"),
        migrations.RenameField(model_name="frame", old_name="posicao", new_name="position"),
        migrations.RenameField(model_name="frame", old_name="duracao_ms", new_name="duration_ms"),
        migrations.RenameField(model_name="cell", old_name="quadro", new_name="frame"),
        migrations.RenameField(model_name="cell", old_name="camada", new_name="layer"),
        migrations.RenameField(model_name="cell", old_name="formato", new_name="encoding"),
        migrations.RenameField(model_name="cell", old_name="tamanho_bytes", new_name="size_bytes"),
        migrations.RenameField(model_name="revision", old_name="projeto", new_name="project"),
        migrations.RenameField(model_name="revision", old_name="numero", new_name="number"),
        migrations.RenameField(model_name="revision", old_name="nome", new_name="name"),
        migrations.RenameField(model_name="revision", old_name="conteudo", new_name="content"),
        migrations.RenameField(model_name="revision", old_name="tamanho_bytes", new_name="size_bytes"),
        migrations.RenameField(model_name="revision", old_name="criado_em", new_name="created_at"),
        migrations.RenameField(model_name="palette", old_name="nome", new_name="name"),
        migrations.RenameField(model_name="palette", old_name="descricao", new_name="description"),
        migrations.RenameField(model_name="palette", old_name="predefinida", new_name="preset"),
        migrations.RenameField(model_name="palette", old_name="criado_em", new_name="created_at"),
        migrations.RenameField(model_name="palette", old_name="atualizado_em", new_name="updated_at"),
        migrations.RenameField(model_name="palettecolor", old_name="paleta", new_name="palette"),
        migrations.RenameField(model_name="palettecolor", old_name="posicao", new_name="position"),
        # 4. Related names and the new default format version (no schema change: both are Python-side only).
        migrations.AlterField(
            model_name="project",
            name="format_version",
            field=models.PositiveSmallIntegerField(default=2),
        ),
        migrations.AlterField(
            model_name="layer",
            name="project",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="layers", to="editor.project"),
        ),
        migrations.AlterField(
            model_name="frame",
            name="project",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="frames", to="editor.project"),
        ),
        migrations.AlterField(
            model_name="cell",
            name="frame",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="cells", to="editor.frame"),
        ),
        migrations.AlterField(
            model_name="cell",
            name="layer",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="cells", to="editor.layer"),
        ),
        migrations.AlterField(
            model_name="revision",
            name="project",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="revisions", to="editor.project"),
        ),
        migrations.AlterField(
            model_name="palettecolor",
            name="palette",
            field=models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="colors", to="editor.palette"),
        ),
        # 5. Default ordering.
        migrations.AlterModelOptions(name="project", options={"ordering": ["-updated_at"]}),
        migrations.AlterModelOptions(name="layer", options={"ordering": ["project", "position"]}),
        migrations.AlterModelOptions(name="frame", options={"ordering": ["project", "position"]}),
        migrations.AlterModelOptions(name="revision", options={"ordering": ["project", "-number"]}),
        migrations.AlterModelOptions(name="palette", options={"ordering": ["-preset", "name"]}),
        migrations.AlterModelOptions(name="palettecolor", options={"ordering": ["palette", "position"]}),
        # 6. Index and constraints again, with English names.
        migrations.AddIndex(
            model_name="project",
            index=models.Index(fields=["-updated_at"], name="project_updated_idx"),
        ),
        migrations.AddConstraint(
            model_name="project",
            constraint=models.CheckConstraint(condition=models.Q(("width__gte", 1), ("width__lte", 1024)), name="project_width_valid"),
        ),
        migrations.AddConstraint(
            model_name="project",
            constraint=models.CheckConstraint(condition=models.Q(("height__gte", 1), ("height__lte", 1024)), name="project_height_valid"),
        ),
        migrations.AddConstraint(
            model_name="project",
            constraint=models.CheckConstraint(condition=models.Q(("fps__gte", 1), ("fps__lte", 60)), name="project_fps_valid"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.UniqueConstraint(fields=("project", "key"), name="layer_key_unique"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.UniqueConstraint(fields=("project", "position"), name="layer_position_unique"),
        ),
        migrations.AddConstraint(
            model_name="layer",
            constraint=models.CheckConstraint(condition=models.Q(("opacity__lte", 100)), name="layer_opacity_valid"),
        ),
        migrations.AddConstraint(
            model_name="frame",
            constraint=models.UniqueConstraint(fields=("project", "key"), name="frame_key_unique"),
        ),
        migrations.AddConstraint(
            model_name="frame",
            constraint=models.UniqueConstraint(fields=("project", "position"), name="frame_position_unique"),
        ),
        migrations.AddConstraint(
            model_name="cell",
            constraint=models.UniqueConstraint(fields=("frame", "layer"), name="cell_unique"),
        ),
        migrations.AddConstraint(
            model_name="revision",
            constraint=models.UniqueConstraint(fields=("project", "number"), name="revision_number_unique"),
        ),
        migrations.AddConstraint(
            model_name="palettecolor",
            constraint=models.UniqueConstraint(fields=("palette", "position"), name="palette_color_position_unique"),
        ),
        migrations.AddConstraint(
            model_name="palettecolor",
            constraint=models.CheckConstraint(condition=models.Q(("hex__regex", "^#[0-9a-f]{6}([0-9a-f]{2})?$")), name="palette_color_hex_valid"),
        ),
        # 7. Data: existing projects are served as format version 2 from now on.
        migrations.RunPython(set_format_version_2, set_format_version_1),
        # 8. PostgreSQL only: names generated from the 1.x tables and columns (keep this operation last).
        migrations.RunPython(rename_generated_names, restore_generated_names),
    ]
