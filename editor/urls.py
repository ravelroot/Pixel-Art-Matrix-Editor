from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.inicio, name="inicio"),
    path("api/v1", api.indice),
    path("api/v1/", api.indice),
    path("api/v1/saude", api.saude, name="saude"),
    path("api/v1/projetos", api.projetos, name="projetos"),
    path("api/v1/projetos/<uuid:projeto_id>", api.projeto, name="projeto"),
    path("api/v1/projetos/<uuid:projeto_id>/miniatura", api.miniatura, name="miniatura"),
    path("api/v1/projetos/<uuid:projeto_id>/exportar", api.exportar, name="exportar"),
    path("api/v1/projetos/<uuid:projeto_id>/revisoes", api.revisoes, name="revisoes"),
    path("api/v1/projetos/<uuid:projeto_id>/revisoes/<int:numero>/restaurar", api.restaurar, name="restaurar"),
    path("api/v1/paletas", api.paletas, name="paletas"),
    path("api/v1/paletas/<uuid:paleta_id>", api.paleta, name="paleta"),
]
