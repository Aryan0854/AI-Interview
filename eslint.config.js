const nextConfig = require("eslint-config-next/core-web-vitals");

module.exports = [
  ...nextConfig,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/rules-of-hooks": "off",
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/refs": "off",
      "react-hooks/purity": "off",
      "react-hooks/immutability": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-assign-module-variable": "off",
      "jsx-a11y/alt-text": "off"
    }
  }
];
