# LMT Mini Portal SOW

Build a small local portal for a manufacturing customer that needs visibility into orders, production timing, and support communication.

## Customer Dashboard

Customers can view open orders, current order status, expected delivery windows, and recent support ticket updates. The dashboard should include loading, empty, and error states.

## Admin Dashboard

Internal staff can view a summary of active customers, urgent support tickets, delayed production items, and orders requiring follow-up.

## Support Tickets

Customers can create support tickets with a subject, description, priority, and related order. Admin users can review ticket status and add internal notes.

## Production Schedule

Show scheduled production batches, target dates, current stage, and delay warnings. The UI must be readable on mobile and desktop.

## Order Status

Orders have statuses such as received, in production, quality review, shipped, and delivered. Customers should be able to filter orders by status.

## AI Support Placeholder

Add a clearly labeled AI support placeholder that can later connect to a support assistant. It must not send real customer messages in the MVP.

## Quality Requirements

- Use a professional dashboard UI.
- Add tests for order status and support ticket behavior.
- Run visual QA at mobile, tablet, laptop, desktop, and wide viewport sizes.
- Do not deploy to production.
- Do not send real emails or text messages.
