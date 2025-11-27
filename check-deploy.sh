#!/bin/bash

# Interview Whisperer - Deployment Health Check
# Run this before deploying to ensure everything is ready

echo "🔍 Interview Whisperer - Pre-Deployment Check"
echo "=============================================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

ERRORS=0

# Check 1: Node version
echo "📦 Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -ge 18 ]; then
    echo -e "${GREEN}✅ Node.js version OK (v$(node -v))${NC}"
else
    echo -e "${RED}❌ Node.js version too old. Need v18+${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 2: Dependencies installed
echo "📚 Checking dependencies..."
if [ -d "node_modules" ]; then
    echo -e "${GREEN}✅ Root dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  Root dependencies missing. Run: npm install${NC}"
    ERRORS=$((ERRORS + 1))
fi

if [ -d "public/node_modules" ]; then
    echo -e "${GREEN}✅ React dependencies installed${NC}"
else
    echo -e "${YELLOW}⚠️  React dependencies missing. Run: cd public && npm install${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 3: React build exists
echo "🏗️  Checking React build..."
if [ -f "public/build/index.html" ]; then
    echo -e "${GREEN}✅ React app built${NC}"
else
    echo -e "${YELLOW}⚠️  React build missing. Run: cd public && npm run build${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Check 4: Environment variables
echo "🔐 Checking environment configuration..."
if [ -f ".env" ]; then
    echo -e "${GREEN}✅ .env file exists${NC}"
    
    # Check required variables
    source .env
    
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -e "${RED}❌ OPENAI_API_KEY not set${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✅ OPENAI_API_KEY set${NC}"
    fi
    
    if [ -z "$REDIS_URL" ]; then
        echo -e "${RED}❌ REDIS_URL not set${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✅ REDIS_URL set${NC}"
    fi
    
    if [ -z "$SESSION_SECRET" ]; then
        echo -e "${RED}❌ SESSION_SECRET not set${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✅ SESSION_SECRET set${NC}"
    fi
    
    if [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ]; then
        echo -e "${RED}❌ Admin credentials not set${NC}"
        ERRORS=$((ERRORS + 1))
    else
        echo -e "${GREEN}✅ Admin credentials set${NC}"
    fi
else
    echo -e "${RED}❌ .env file missing. Copy from .env.example${NC}"
    ERRORS=$((ERRORS + 1))
fi
echo ""

# Summary
echo "=============================================="
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ ALL CHECKS PASSED!${NC}"
    echo -e "${GREEN}🚀 Ready to deploy!${NC}"
    exit 0
else
    echo -e "${RED}❌ $ERRORS issue(s) found${NC}"
    echo -e "${YELLOW}Please fix the issues above before deploying${NC}"
    exit 1
fi
