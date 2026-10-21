from django.urls import include, path

urlpatterns = [
    path("", include("editor.urls")),
]
