FROM python:3.12-slim

WORKDIR /app

# Before the source copy on purpose: editing app.py shouldn't reinstall Flask.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home appuser
USER appuser

EXPOSE 5000
CMD ["gunicorn", "-b", "0.0.0.0:5000", "app:app"]
