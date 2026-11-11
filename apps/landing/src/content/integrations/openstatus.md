---
name: "OpenStatus"
logo: "/integrations/openstatus.svg"
tagline: "Monitor alerts and uptime notifications for your services"
description: "Connect OpenStatus to receive monitor alerts directly in your channels. Get instant notifications when your services go down or recover, keeping your team informed about system health."

category: "devops"
status: "available"

features:
    - title: "Monitor Status Alerts"
      description: "Get instant notifications when monitors detect downtime. Know immediately when your services need attention."
      icon: "bolt"
    - title: "Recovery Notifications"
      description: "Receive alerts when services come back online. Track incident duration and celebrate when things are back to normal."
      icon: "check"
    - title: "Latency Tracking"
      description: "Monitor response time degradation. Get notified when latency exceeds your thresholds before users complain."
      icon: "sync"
    - title: "Rich Status Embeds"
      description: "See detailed status information in notifications. Response times, error codes, and check locations at a glance."
      icon: "message"
    - title: "Incident Timeline"
      description: "Track the full incident lifecycle. From first alert to recovery, maintain a clear timeline of events."
      icon: "file"

useCases:
    - title: "On-Call Alerting"
      description: "Route critical alerts to on-call channels. When services go down, the right people know immediately and can coordinate response in Hazel."
    - title: "Team Visibility"
      description: "Keep your entire team informed about system health. Everyone sees status changes, reducing 'is it down?' messages and improving coordination."
    - title: "Incident Documentation"
      description: "Alerts create a natural incident timeline in your channels. Reference past incidents, track patterns, and improve your reliability over time."

faqs:
    - question: "How do I set up OpenStatus with Hazel?"
      answer: "In your OpenStatus dashboard, add a webhook notification channel pointing to your Hazel webhook URL. You'll find this URL in Settings > Integrations > OpenStatus."
    - question: "Which monitors can send alerts to Hazel?"
      answer: "All OpenStatus monitor types work with Hazel—HTTP, TCP, and DNS monitors. Configure each monitor to send notifications to your webhook."
    - question: "Can I route different monitors to different channels?"
      answer: "Yes! Create multiple webhook endpoints in Hazel for different channels, then configure each OpenStatus monitor to use the appropriate webhook."
    - question: "What information is included in alerts?"
      answer: "Alerts include monitor name, status, response time, error details, and check location. You get full context to understand and respond to issues."

primaryCta:
    text: "Get started for free"
    href: "https://app.hazel.sh"
secondaryCta:
    text: "View Documentation"
    href: "https://docs.hazel.sh/integrations/openstatus"

metaTitle: "OpenStatus Integration | Hazel"
metaDescription: "Connect OpenStatus with Hazel for real-time uptime monitoring. Receive alerts when services go down and track recovery."

draft: false
---
