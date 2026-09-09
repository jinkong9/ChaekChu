FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 8000

CMD ["sh", "-c", "exec uvicorn recommendation.api:app --host 0.0.0.0 --port \"${AI_PORT:-8000}\" --log-level \"${AI_LOG_LEVEL:-info}\""]
