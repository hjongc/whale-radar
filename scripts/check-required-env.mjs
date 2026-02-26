const requiredKeys = ["NEXT_PUBLIC_APP_NAME", "NEXT_PUBLIC_API_BASE_URL"];

const missing = requiredKeys.filter((key) => {
  const value = process.env[key];
  return !value || value.trim().length === 0;
});

if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(", ")}`);
  process.exit(1);
}

console.log("All required environment variables are set.");
