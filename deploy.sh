#!/bin/bash
# =============================================================================
# Cisco Spaces WiFi7 Dashboard - Deploy Script
# Commits to GitHub and deploys to AWS EC2
# =============================================================================

set -e  # Exit on error

# Configuration
REPO_URL="https://github.com/santpati/spaces-wifi7-deployment-visualizer.git"
SSH_KEY="/Users/santpati/Desktop/Folders/AI/Santosh-Demo.pem"
EC2_HOST="ec2-user@ec2-3-236-4-188.compute-1.amazonaws.com"
REMOTE_DIR="/home/ec2-user/spaces-wifi7-dashboard"
PORT=8000

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  WiFi7 Dashboard Deploy Script${NC}"
echo -e "${BLUE}========================================${NC}"

# Get the script's directory (project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "Working directory: ${BLUE}$SCRIPT_DIR${NC}"

# =============================================================================
# STEP 1: Git Operations
# =============================================================================
echo -e "\n${YELLOW}[1/4] Setting up Git remote...${NC}"

# Check if we're in a git repo
if [ ! -d ".git" ]; then
    echo -e "${RED}ERROR: Not a git repository. Initializing...${NC}"
    git init
fi

# Check if origin exists and update it
if git remote | grep -q "origin"; then
    CURRENT_URL=$(git remote get-url origin 2>/dev/null || echo "")
    if [ "$CURRENT_URL" != "$REPO_URL" ]; then
        echo "Updating remote origin to $REPO_URL"
        git remote set-url origin "$REPO_URL"
    else
        echo "Remote already set to $REPO_URL"
    fi
else
    echo "Adding remote origin: $REPO_URL"
    git remote add origin "$REPO_URL"
fi

echo -e "\n${YELLOW}[2/4] Committing changes...${NC}"

# Only add files in this directory (not parent directories)
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
    echo "No changes to commit"
else
    # Get commit message from argument or use default
    COMMIT_MSG="${1:-Auto-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"
    git commit -m "$COMMIT_MSG"
    echo -e "${GREEN}✓ Changes committed${NC}"
fi

echo -e "\n${YELLOW}[3/4] Pushing to GitHub...${NC}"

# Fetch and check for divergence
git fetch origin main 2>/dev/null || true

# Try to push, force if needed (for initial sync)
if ! git push -u origin main 2>/dev/null; then
    echo "Regular push failed, attempting force push..."
    git push -u origin main --force
fi
echo -e "${GREEN}✓ Pushed to GitHub${NC}"

# =============================================================================
# STEP 2: Deploy to AWS EC2
# =============================================================================
echo -e "\n${YELLOW}[4/4] Deploying to AWS EC2...${NC}"

# Check SSH key exists
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${RED}ERROR: SSH key not found at $SSH_KEY${NC}"
    exit 1
fi

# Ensure correct permissions on SSH key
chmod 400 "$SSH_KEY"

# Create deployment commands
DEPLOY_COMMANDS=$(cat << 'EOF'
# Stop existing server on port 8000 if running
echo "Stopping existing server on port 8000..."
pkill -f "python.*http.server.*8000" 2>/dev/null || true
sleep 1

# Create directory if not exists
mkdir -p /home/ec2-user/spaces-wifi7-dashboard

# Clone or pull latest from GitHub
cd /home/ec2-user
if [ -d "spaces-wifi7-dashboard/.git" ]; then
    echo "Pulling latest changes..."
    cd spaces-wifi7-dashboard
    git fetch origin
    git reset --hard origin/main
else
    echo "Cloning repository..."
    rm -rf spaces-wifi7-dashboard
    git clone https://github.com/santpati/spaces-wifi7-deployment-visualizer.git spaces-wifi7-dashboard
    cd spaces-wifi7-dashboard
fi

# Start HTTP server on port 8000 in background
echo "Starting HTTP server on port 8000..."
nohup python3 -m http.server 8000 > /tmp/wifi7-dashboard.log 2>&1 &
sleep 2

# Verify server is running
if curl -s http://localhost:8000 > /dev/null; then
    echo "✓ Server is running on port 8000"
    PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "ec2-3-236-4-188.compute-1.amazonaws.com")
    echo "Dashboard URL: http://$PUBLIC_IP:8000"
else
    echo "WARNING: Server may not have started correctly"
    cat /tmp/wifi7-dashboard.log
fi
EOF
)

# Execute deployment on EC2
ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$EC2_HOST" "$DEPLOY_COMMANDS"

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Dashboard: ${BLUE}http://ec2-3-236-4-188.compute-1.amazonaws.com:8000${NC}"
echo -e "GitHub:    ${BLUE}https://github.com/santpati/spaces-wifi7-deployment-visualizer${NC}"

