import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Paleta",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                (
                    "slug",
                    models.SlugField(blank=True, max_length=60, null=True, unique=True),
                ),
                ("nome", models.CharField(max_length=80)),
                ("descricao", models.CharField(blank=True, default="", max_length=240)),
                ("predefinida", models.BooleanField(default=False)),
                ("criado_em", models.DateTimeField(auto_now_add=True)),
                ("atualizado_em", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "paleta",
                "ordering": ["-predefinida", "nome"],
            },
        ),
        migrations.CreateModel(
            name="Projeto",
            fields=[
                (
                    "id",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("nome", models.CharField(max_length=120)),
                ("largura", models.PositiveSmallIntegerField()),
                ("altura", models.PositiveSmallIntegerField()),
                ("fps", models.PositiveSmallIntegerField(default=8)),
                ("versao_formato", models.PositiveSmallIntegerField(default=1)),
                ("revisao", models.PositiveIntegerField(default=1)),
                ("paleta", models.JSONField(blank=True, default=list)),
                ("miniatura", models.BinaryField(blank=True, null=True)),
                ("criado_em", models.DateTimeField(auto_now_add=True)),
                ("atualizado_em", models.DateTimeField(auto_now=True)),
            ],
            options={
                "db_table": "projeto",
                "ordering": ["-atualizado_em"],
                "indexes": [
                    models.Index(
                        fields=["-atualizado_em"], name="projeto_atualizado_idx"
                    )
                ],
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("largura__gte", 1), ("largura__lte", 1024)),
                        name="projeto_largura_valida",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("altura__gte", 1), ("altura__lte", 1024)),
                        name="projeto_altura_valida",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("fps__gte", 1), ("fps__lte", 60)),
                        name="projeto_fps_valido",
                    ),
                ],
            },
        ),
        migrations.CreateModel(
            name="Camada",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("chave", models.CharField(max_length=40)),
                ("posicao", models.PositiveSmallIntegerField()),
                ("nome", models.CharField(max_length=80)),
                ("visivel", models.BooleanField(default=True)),
                ("opacidade", models.PositiveSmallIntegerField(default=100)),
                ("bloqueada", models.BooleanField(default=False)),
                (
                    "projeto",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="camadas",
                        to="editor.projeto",
                    ),
                ),
            ],
            options={
                "db_table": "camada",
                "ordering": ["projeto", "posicao"],
            },
        ),
        migrations.CreateModel(
            name="Quadro",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("chave", models.CharField(max_length=40)),
                ("posicao", models.PositiveSmallIntegerField()),
                ("duracao_ms", models.PositiveIntegerField(blank=True, null=True)),
                (
                    "projeto",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="quadros",
                        to="editor.projeto",
                    ),
                ),
            ],
            options={
                "db_table": "quadro",
                "ordering": ["projeto", "posicao"],
            },
        ),
        migrations.CreateModel(
            name="Celula",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("formato", models.CharField(default="rle-rgba", max_length=16)),
                ("pixels", models.BinaryField()),
                ("tamanho_bytes", models.PositiveIntegerField()),
                (
                    "camada",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="celulas",
                        to="editor.camada",
                    ),
                ),
                (
                    "quadro",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="celulas",
                        to="editor.quadro",
                    ),
                ),
            ],
            options={
                "db_table": "celula",
            },
        ),
        migrations.CreateModel(
            name="Revisao",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("numero", models.PositiveIntegerField()),
                ("nome", models.CharField(max_length=120)),
                ("conteudo", models.BinaryField()),
                ("tamanho_bytes", models.PositiveIntegerField()),
                ("criado_em", models.DateTimeField(auto_now_add=True)),
                (
                    "projeto",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="revisoes",
                        to="editor.projeto",
                    ),
                ),
            ],
            options={
                "db_table": "revisao",
                "ordering": ["projeto", "-numero"],
            },
        ),
        migrations.CreateModel(
            name="CorPaleta",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                ("posicao", models.PositiveSmallIntegerField()),
                ("hex", models.CharField(max_length=9)),
                (
                    "paleta",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name="cores",
                        to="editor.paleta",
                    ),
                ),
            ],
            options={
                "db_table": "cor_paleta",
                "ordering": ["paleta", "posicao"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("paleta", "posicao"), name="cor_posicao_unica"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("hex__regex", "^#[0-9a-f]{6}([0-9a-f]{2})?$")
                        ),
                        name="cor_hex_valido",
                    ),
                ],
            },
        ),
        migrations.AddConstraint(
            model_name="camada",
            constraint=models.UniqueConstraint(
                fields=("projeto", "chave"), name="camada_chave_unica"
            ),
        ),
        migrations.AddConstraint(
            model_name="camada",
            constraint=models.UniqueConstraint(
                fields=("projeto", "posicao"), name="camada_posicao_unica"
            ),
        ),
        migrations.AddConstraint(
            model_name="camada",
            constraint=models.CheckConstraint(
                condition=models.Q(("opacidade__lte", 100)),
                name="camada_opacidade_valida",
            ),
        ),
        migrations.AddConstraint(
            model_name="quadro",
            constraint=models.UniqueConstraint(
                fields=("projeto", "chave"), name="quadro_chave_unica"
            ),
        ),
        migrations.AddConstraint(
            model_name="quadro",
            constraint=models.UniqueConstraint(
                fields=("projeto", "posicao"), name="quadro_posicao_unica"
            ),
        ),
        migrations.AddConstraint(
            model_name="celula",
            constraint=models.UniqueConstraint(
                fields=("quadro", "camada"), name="celula_unica"
            ),
        ),
        migrations.AddConstraint(
            model_name="revisao",
            constraint=models.UniqueConstraint(
                fields=("projeto", "numero"), name="revisao_numero_unico"
            ),
        ),
    ]
