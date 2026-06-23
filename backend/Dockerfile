# Base image
FROM python:3.9-slim

# Set working directory
WORKDIR /app

# Install system dependencies (if any needed for other libs, but binary usually suffice)
# RUN apt-get update && apt-get install -y gcc libpq-dev && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY . .

# Create uploads directory and set permissions
RUN mkdir -p uploads && chmod -R 777 uploads

# Expose port
EXPOSE 8000

# Command to run the application
CMD ["uvicorn", "backend_app:app", "--host", "0.0.0.0", "--port", "8000"]
