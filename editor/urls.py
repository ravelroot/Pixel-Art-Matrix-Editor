from django.urls import path

from . import api, views

urlpatterns = [
    path("", views.home, name="home"),
    path("api/v2", api.index),
    path("api/v2/", api.index),
    path("api/v2/health", api.health, name="health"),
    path("api/v2/projects", api.projects, name="projects"),
    path("api/v2/projects/<uuid:project_id>", api.project, name="project"),
    path("api/v2/projects/<uuid:project_id>/thumbnail", api.thumbnail, name="thumbnail"),
    path("api/v2/projects/<uuid:project_id>/export", api.export, name="export"),
    path("api/v2/projects/<uuid:project_id>/png", api.png, name="png"),
    path("api/v2/projects/<uuid:project_id>/revisions", api.revisions, name="revisions"),
    path("api/v2/projects/<uuid:project_id>/revisions/<int:number>/restore", api.restore, name="restore"),
    path("api/v2/palettes", api.palettes, name="palettes"),
    path("api/v2/palettes/<uuid:palette_id>", api.palette, name="palette"),
]
