---
name: "Linear"
logo: "/integrations/linear.svg"
tagline: "Streamline software projects, sprints, and bug tracking"
description: "Connect Linear to create issues directly from conversations and link existing tickets for seamless project management. Keep your team aligned with rich issue previews right in your chat."

category: "project-management"
status: "available"
featured: true

features:
    - title: "Create Issues from Messages"
      description: "Use the /issue command to quickly create Linear issues right from chat. Capture context and create tickets without leaving Hazel."
      icon: "message"
    - title: "Auto-Link Linear Tickets"
      description: "Automatically detect and link Linear issue IDs in your messages. See rich previews with status, assignee, and priority at a glance."
      icon: "sync"
    - title: "Issue Status Updates"
      description: "Get notified when linked Linear issues change status. Stay in sync with your team's progress without leaving Hazel."
      icon: "bell"

useCases:
    - title: "Quick Issue Creation"
      description: "When someone reports a bug or suggests a feature in chat, use /issue to instantly create a Linear ticket. Capture the context while it's fresh, then keep the conversation going."
    - title: "Cross-Team Coordination"
      description: "Engineering discussing a feature with product? Paste Linear issue links directly in the thread. Everyone sees rich previews with status and assignee at a glance."
    - title: "Context-Rich Discussions"
      description: "Link relevant Linear issues in your conversations. Rich previews show status, priority, and assignee so everyone has the context they need without switching apps."

faqs:
    - question: "How do I connect Linear to Hazel?"
      answer: "Go to Settings > Integrations in Hazel, click on Linear, and authorize with your Linear workspace. You'll need admin permissions in Linear to complete the setup."
    - question: "Can I create issues from any message?"
      answer: "Yes! Use the /issue command followed by a title to quickly create a Linear issue. The issue is created in your default team."
    - question: "Which Linear fields are supported?"
      answer: "When creating issues, we support title and description. Issue previews show title, status, priority, assignee, and labels."
    - question: "Is there a command to create issues?"
      answer: "Yes! Use the /issue command followed by a title and optional description to quickly create a Linear issue right from the message input."

primaryCta:
    text: "Get started for free"
    href: "https://app.hazel.sh"
secondaryCta:
    text: "View Documentation"
    href: "https://docs.hazel.sh/integrations/linear"

metaTitle: "Linear Integration | Hazel"
metaDescription: "Connect Linear with Hazel for seamless issue tracking. Create issues from messages and auto-link tickets with rich previews."

draft: false
---
