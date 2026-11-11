---
name: "GitHub"
logo: "/integrations/github.svg"
tagline: "Link pull requests and automate workflows"
description: "Integrate GitHub to link repositories, track pull requests, and receive notifications about code changes. Streamline your development workflow with automatic PR updates and issue tracking."

category: "devops"
status: "available"
featured: true

features:
    - title: "Link Pull Requests"
      description: "Automatically detect GitHub PR links and show rich previews with status, reviewers, and CI checks right in your conversations."
      icon: "sync"
    - title: "Automated Notifications"
      description: "Receive real-time updates when PRs are opened, merged, or when CI checks pass or fail. Stay informed without constantly checking GitHub."
      icon: "bolt"
    - title: "Repository Browsing"
      description: "Search and reference repositories, issues, and pull requests directly from Hazel. Share code context without switching apps."
      icon: "file"
    - title: "Deployment Alerts"
      description: "Get notified when deployments succeed or fail. Keep your team informed about what's shipping to production."
      icon: "shield"

useCases:
    - title: "Code Review Workflow"
      description: "When a PR is ready for review, share it in your team channel. Reviewers get notified, discussions happen in context, and everyone sees when it's approved and merged."
    - title: "Release Coordination"
      description: "Coordinate releases across teams. Get deployment notifications, track what's shipping, and celebrate successful releases—all in the same place your team communicates."
    - title: "Incident Response"
      description: "When CI fails or a deployment breaks, get instant notifications in the right channels. Link to the failing PR, discuss fixes, and track resolution together."

faqs:
    - question: "How do I connect GitHub to Hazel?"
      answer: "Navigate to Settings > Integrations, select GitHub, and authorize with your GitHub account. You can then choose which repositories to connect."
    - question: "Can I connect multiple repositories?"
      answer: "Yes! Connect as many repositories as you need. Each repository's notifications can be routed to different channels based on your preferences."
    - question: "What GitHub events trigger notifications?"
      answer: "We support PR opened/closed/merged, review requests, CI status changes, deployments, and releases. You can configure which events you want to receive."
    - question: "Does it work with GitHub Enterprise?"
      answer: "Yes, we support both GitHub.com and GitHub Enterprise. Contact support for Enterprise setup assistance."
    - question: "Can I create GitHub issues from Hazel?"
      answer: "Not yet—this feature is on our roadmap. For now, you can link and preview existing issues and PRs directly in your conversations."

primaryCta:
    text: "Get started for free"
    href: "https://app.hazel.sh"
secondaryCta:
    text: "View Documentation"
    href: "https://docs.hazel.sh/integrations/github"

metaTitle: "GitHub Integration | Hazel"
metaDescription: "Connect GitHub with Hazel for seamless code collaboration. Track PRs, get review notifications, and automate your development workflow."

draft: false
---
