-- Reaction totals by what caused each card. Run with: npm run feedback
SELECT source, reasons, reaction, COUNT(*) AS cards
FROM suggestions
GROUP BY source, reasons, reaction
ORDER BY source, reasons, reaction;
