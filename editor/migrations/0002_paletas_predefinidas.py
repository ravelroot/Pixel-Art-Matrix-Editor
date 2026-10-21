from django.db import migrations


def criar(apps, schema_editor):
    from editor.paletas import sincronizar_predefinidas

    sincronizar_predefinidas(apps.get_model("editor", "Paleta"), apps.get_model("editor", "CorPaleta"))


def remover(apps, schema_editor):
    apps.get_model("editor", "Paleta").objects.filter(predefinida=True).delete()


class Migration(migrations.Migration):
    dependencies = [("editor", "0001_inicial")]

    operations = [migrations.RunPython(criar, remover)]
