---
name: "Railway"
logo: "/integrations/railway.svg"
tagline: "Deployment notifications and alerts for your Railway projects"
description: "Connect Railway to receive deployment notifications directly in your channels. Get instant alerts when deployments succeed, fail, or crash, keeping your team informed about your infrastructure status."

category: "devops"
status: "available"

features:
    - title: "Deployment Status Alerts"
      description: "Get notified when deployments start, succeed, or fail. Track every release to production in real-time."
      icon: "bolt"
    - title: "Build Notifications"
      description: "Follow build progress and catch failures early. Know when builds complete or encounter errors."
      icon: "sync"
    - title: "Crash Alerts"
      description: "Receive immediate notifications when services crash. Respond quickly to production issues before users are impacted."
      icon: "shield"
    - title: "Rich Deployment Embeds"
      description: "See deployment details at a glance—commit info, build logs link, and deployment status in a clean embed."
      icon: "message"
    - title: "Service Health Tracking"
      description: "Monitor your Railway services from Hazel. Keep tabs on all your deployed applications in one place."
      icon: "check"

useCases:
    - title: "Deployment Coordination"
      description: "Share deployment status with your whole team. Everyone knows when new features ship, and engineers can coordinate releases without checking Railway constantly."
    - title: "Production Incident Response"
      description: "When deployments fail or services crash, get alerted in your incident channel immediately. Coordinate fixes and track resolution together."
    - title: "Release Tracking"
      description: "Build a natural changelog in your channels. Every deployment notification creates a record of what shipped and when."

faqs:
    - question: "How do I connect Railway to Hazel?"
      answer: "In your Railway project settings, add a webhook integration pointing to your Hazel webhook URL. Find this URL in Settings > Integrations > Railway."
    - question: "Which Railway events trigger notifications?"
      answer: "We support deployment started, deployment success, deployment failed, and service crash events. Configure which events you want in Railway's webhook settings."
    - question: "Can I connect multiple Railway projects?"
      answer: "Yes! Each Railway project can have its own webhook. Route different projects to different Hazel channels based on your team structure."
    - question: "Do I need a paid Railway plan?"
      answer: "Webhooks are available on all Railway plans. The integration works the same whether you're on the free tier or a paid plan."

primaryCta:
    text: "Get started for free"
    href: "https://app.hazel.sh"
secondaryCta:
    text: "View Documentation"
    href: "https://docs.hazel.sh/integrations/railway"

metaTitle: "Railway Integration | Hazel"
metaDescription: "Connect Railway with Hazel for deployment notifications. Get alerts for successful deployments, failures, and crashes."

draft: false
---
