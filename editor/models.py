import uuid

from django.db import models
from django.db.models import Q


class Projeto(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    nome = models.CharField(max_length=120)
    largura = models.PositiveSmallIntegerField()
    altura = models.PositiveSmallIntegerField()
    fps = models.PositiveSmallIntegerField(default=8)
    versao_formato = models.PositiveSmallIntegerField(default=1)
    revisao = models.PositiveIntegerField(default=1)
    paleta = models.JSONField(default=list, blank=True)
    miniatura = models.BinaryField(null=True, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "projeto"
        ordering = ["-atualizado_em"]
        indexes = [models.Index(fields=["-atualizado_em"], name="projeto_atualizado_idx")]
        constraints = [
            models.CheckConstraint(condition=Q(largura__gte=1, largura__lte=1024), name="projeto_largura_valida"),
            models.CheckConstraint(condition=Q(altura__gte=1, altura__lte=1024), name="projeto_altura_valida"),
            models.CheckConstraint(condition=Q(fps__gte=1, fps__lte=60), name="projeto_fps_valido"),
        ]

    def __str__(self):
        return f"{self.nome} ({self.largura}x{self.altura})"


class Camada(models.Model):
    projeto = models.ForeignKey(Projeto, on_delete=models.CASCADE, related_name="camadas")
    chave = models.CharField(max_length=40)
    posicao = models.PositiveSmallIntegerField()
    nome = models.CharField(max_length=80)
    visivel = models.BooleanField(default=True)
    opacidade = models.PositiveSmallIntegerField(default=100)
    bloqueada = models.BooleanField(default=False)

    class Meta:
        db_table = "camada"
        ordering = ["projeto", "posicao"]
        constraints = [
            models.UniqueConstraint(fields=["projeto", "chave"], name="camada_chave_unica"),
            models.UniqueConstraint(fields=["projeto", "posicao"], name="camada_posicao_unica"),
            models.CheckConstraint(condition=Q(opacidade__lte=100), name="camada_opacidade_valida"),
        ]

    def __str__(self):
        return self.nome


class Quadro(models.Model):
    projeto = models.ForeignKey(Projeto, on_delete=models.CASCADE, related_name="quadros")
    chave = models.CharField(max_length=40)
    posicao = models.PositiveSmallIntegerField()
    duracao_ms = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        db_table = "quadro"
        ordering = ["projeto", "posicao"]
        constraints = [
            models.UniqueConstraint(fields=["projeto", "chave"], name="quadro_chave_unica"),
            models.UniqueConstraint(fields=["projeto", "posicao"], name="quadro_posicao_unica"),
        ]

    def __str__(self):
        return f"Quadro {self.posicao + 1}"


class Celula(models.Model):
    quadro = models.ForeignKey(Quadro, on_delete=models.CASCADE, related_name="celulas")
    camada = models.ForeignKey(Camada, on_delete=models.CASCADE, related_name="celulas")
    formato = models.CharField(max_length=16, default="rle-rgba")
    pixels = models.BinaryField()
    tamanho_bytes = models.PositiveIntegerField()

    class Meta:
        db_table = "celula"
        constraints = [models.UniqueConstraint(fields=["quadro", "camada"], name="celula_unica")]


class Revisao(models.Model):
    projeto = models.ForeignKey(Projeto, on_delete=models.CASCADE, related_name="revisoes")
    numero = models.PositiveIntegerField()
    nome = models.CharField(max_length=120)
    conteudo = models.BinaryField()
    tamanho_bytes = models.PositiveIntegerField()
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "revisao"
        ordering = ["projeto", "-numero"]
        constraints = [models.UniqueConstraint(fields=["projeto", "numero"], name="revisao_numero_unico")]


class Paleta(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=60, unique=True, null=True, blank=True)
    nome = models.CharField(max_length=80)
    descricao = models.CharField(max_length=240, blank=True, default="")
    predefinida = models.BooleanField(default=False)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "paleta"
        ordering = ["-predefinida", "nome"]

    def __str__(self):
        return self.nome


class CorPaleta(models.Model):
    paleta = models.ForeignKey(Paleta, on_delete=models.CASCADE, related_name="cores")
    posicao = models.PositiveSmallIntegerField()
    hex = models.CharField(max_length=9)

    class Meta:
        db_table = "cor_paleta"
        ordering = ["paleta", "posicao"]
        constraints = [
            models.UniqueConstraint(fields=["paleta", "posicao"], name="cor_posicao_unica"),
            models.CheckConstraint(condition=Q(hex__regex=r"^#[0-9a-f]{6}([0-9a-f]{2})?$"), name="cor_hex_valido"),
        ]
