# 本番用イメージ。Chromium と日本語フォントを同梱する。
FROM python:3.11-slim

# Chromium の実行に必要なライブラリと、日本語フォント（IPAゴシック）
RUN apt-get update && apt-get install -y --no-install-recommends \
        fonts-ipafont-gothic \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
        libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
        libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt gunicorn \
    && python -m playwright install chromium

COPY src ./src
COPY samples ./samples

ENV PYTHONPATH=/app/src \
    PYTHONUNBUFFERED=1 \
    PLANNER_DB=/data/orders.db \
    PLANNER_OUTPUT_DIR=/data/generated

# 生成したPDFと注文台帳の置き場所。無料プランでは再起動で消えるため、
# 本番運用では永続ディスクをマウントすること（DEPLOY.md 参照）。
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8000

# PDF生成に数秒かかるため、タイムアウトを長めに取る。
# 同時生成でメモリを食うのでワーカーは2に抑える。
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "--timeout", "180", \
     "planner.wsgi:app"]
