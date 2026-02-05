#!/bin/bash
# Lightsail 인스턴스 초기 설정 스크립트
# Ubuntu/Debian 기반 인스턴스용

set -e

echo "=== Updating system packages ==="
sudo apt-get update
sudo apt-get upgrade -y

echo "=== Installing Docker ==="
# Remove old versions
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group
sudo usermod -aG docker $USER

echo "=== Starting Docker service ==="
sudo systemctl start docker
sudo systemctl enable docker

echo "=== Installing additional tools ==="
sudo apt-get install -y htop nginx certbot python3-certbot-nginx

echo "=== Setting up firewall ==="
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw allow 3000/tcp  # Backend API (optional, remove if using nginx proxy)
sudo ufw --force enable

echo "=== Setup complete! ==="
echo "Please log out and log back in for docker group changes to take effect."
echo ""
echo "Next steps:"
echo "1. Configure Nginx as reverse proxy (optional)"
echo "2. Set up SSL with certbot (optional)"
echo "3. Add GitHub Secrets for deployment"
