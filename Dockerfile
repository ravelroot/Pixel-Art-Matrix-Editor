FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=crivo.settings \
    CRIVO_DEBUG=false

WORKDIR /app
RUN groupadd --system crivo && useradd --system --gid crivo --home-dir /app crivo

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY manage.py VERSION ./
COPY crivo ./crivo
COPY editor ./editor
# A chave abaixo só existe durante o build (o collectstatic não usa a chave); a de produção vem do .env.
RUN CRIVO_SECRET_KEY=build-somente-para-coletar-arquivos-estaticos-0000 python manage.py collectstatic --noinput && chown -R crivo:crivo /app

USER crivo
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/v1/saude', timeout=2).status == 200 else 1)"
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn crivo.wsgi:application --bind 0.0.0.0:8000 --workers ${CRIVO_WORKERS:-2} --access-logfile -"]
