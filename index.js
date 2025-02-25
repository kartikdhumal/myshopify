import crypto from 'crypto';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import fs from 'fs';

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;

const SHOPIFY_API_KEY = "9cffa3f7656b20a58f9b29bd6ede999f";
const SHOPIFY_API_SECRET = "7b26326081ecf1a5f19a0c6e1a999982";
const NGROK_URL = "https://5e6b-2402-3a80-1cf0-c224-c10f-3c02-392a-6164.ngrok-free.app";
const SCOPE = "read_products,write_products,read_customers,write_customers,read_orders,write_orders,read_draft_orders,write_draft_orders,read_inventory,write_inventory,read_shipping,write_shipping,read_fulfillments,write_fulfillments,read_discounts,write_discounts,read_marketing_events,write_marketing_events,read_checkouts,write_checkouts,read_price_rules,write_price_rules,read_shopify_payments_payouts,read_reports,read_analytics";

const TOKEN_FILE = "tokens.json";

// shpua_c72537037f8d4c6cab1d9b698a76dbb8

let storeTokens = {};

app.get('/', (req, res) => {
    res.json("Hello World from Shopify GraphQL");
});

app.get("/auth", (req, res) => {
    const shop = "my-auth-store.myshopify.com";
    if (!shop) return res.send("Shop parameter missing");

    const state = crypto.randomBytes(16).toString("hex");
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${SCOPE}&redirect_uri=${NGROK_URL}/auth/callback&state=${state}&response_type=code`;
    res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
    const { shop, code } = req.query;
    if (!shop || !code) return res.send("Invalid request");

    try {
        const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
            client_id: SHOPIFY_API_KEY,
            client_secret: SHOPIFY_API_SECRET,
            code
        });

        const accessToken = response.data.access_token;
        console.log(response.data);
        storeTokens[shop] = accessToken;
        saveTokens();
        console.log("Access Token:", accessToken);

        res.send("Authentication successful! You can now fetch data.");
    } catch (err) {
        console.error("Error fetching access token:", err);
        res.send("Authentication failed.");
    }
});

app.post("/register-webhook", async (req, res) => {
    const { shop, accessToken } = req.body;

    if (!shop || !accessToken) {
        return res.status(400).json({ error: "Missing shop or access token" });
    }

    const url = `https://${shop}/admin/api/2023-10/webhooks.json`;

    const webhookData = {
        webhook: {
            topic: "app/uninstalled",
            address: "https://my-public-app.com/webhooks/uninstall",
            format: "json",
        },
    };

    try {
        const response = await axios.post(url, webhookData, {
            headers: {
                "X-Shopify-Access-Token": accessToken,
                "Content-Type": "application/json",
            },
        });

        res.json({ success: true, data: response.data });
    } catch (error) {
        res.status(500).json({ error: error.response?.data || "Webhook registration failed" });
    }
});

app.post("/webhook/app/uninstalled", (req, res) => {
    const shop = req.body?.domain;

    if (!shop) {
        return res.status(400).send("Invalid webhook data");
    }
    console.log(`App uninstalled from ${shop}`);
    res.status(200).send("Webhook received");
});

app.get("/products", async (req, res) => {
    const shop = req.query.shop;
    if (!shop) return res.status(400).send("Shop parameter missing");

    if (!storeTokens[shop] && fs.existsSync(TOKEN_FILE)) {
        storeTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    }

    const accessToken = storeTokens[shop];
    if (!accessToken) return res.status(401).send("Shop not authenticated");

    try {
        const response = await axios.post(
            `https://${shop}/admin/api/2024-01/graphql.json`,
            {
                query: `{
                    products(first: 5) {
                        edges {
                            node {
                                id
                                title
                                variants(first: 1) {
                                    edges {
                                        node {
                                            price
                                        }
                                    }
                                }
                            }
                        }
                    }
                }`
            },
            {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json"
                }
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error("GraphQL Error:", error.response?.data || error.message);
        res.status(500).send("Failed to fetch products.");
    }
});

app.post("/createuser", async (req, res) => {
    try {
        const shop = req.query.shop;

        if (!shop) return res.status(400).json({ error: "Shop parameter missing" });

        if (!storeTokens[shop] && fs.existsSync(TOKEN_FILE)) {
            storeTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
        }

        const accessToken = storeTokens[shop];
        if (!accessToken) return res.status(401).json({ error: "Shop not authenticated" });

        const { firstName, lastName, email, phone } = req.body;
        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: "First name, last name, and email are required." });
        }

        const query = `
            mutation customerCreate($input: CustomerInput!) {
                customerCreate(input: $input) {
                    customer {
                        id
                        email
                        firstName
                        lastName
                        phone
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;

        const variables = { input: { firstName, lastName, email, phone } };

        const response = await axios.post(
            `https://${shop}/admin/api/2025-01/customers.json`,
            { query, variables },
            {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json"
                }
            }
        );
        const responseData = response.data;
        console.log("Shopify Response:", JSON.stringify(responseData, null, 2));

        if (responseData.data.customerCreate.userErrors.length > 0) {
            return res.status(400).json({ error: responseData.data.customerCreate.userErrors });
        }

        res.json({ success: true, customer: responseData.data.customerCreate.customer });

    } catch (error) {
        console.error("GraphQL Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create customer." });
    }
});

app.post("/getuser", async (req, res) => {
    try {
        const shop = req.query.shop;

        if (!shop) return res.status(400).json({ error: "Shop parameter missing" });

        if (!storeTokens[shop] && fs.existsSync(TOKEN_FILE)) {
            storeTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
        }

        const accessToken = storeTokens[shop];
        if (!accessToken) return res.status(401).json({ error: "Shop not authenticated" });

        const query = `
            mutation customerCreate($input: CustomerInput!) {
                customerCreate(input: $input) {
                    customer {
                        id
                        email
                        firstName
                        lastName
                        phone
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;

        const variables = { input: { firstName, lastName, email, phone } };

        const response = await axios.post(
            `https://${shop}/admin/api/2025-01/customers.json`,
            { query, variables },
            {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json"
                }
            }
        );
        const responseData = response.data;
        console.log("Shopify Response:", JSON.stringify(responseData, null, 2));

        if (responseData.data.customerCreate.userErrors.length > 0) {
            return res.status(400).json({ error: responseData.data.customerCreate.userErrors });
        }

        res.json({ success: true, customer: responseData.data.customerCreate.customer });

    } catch (error) {
        console.error("GraphQL Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create customer." });
    }
});

// 7797558804550

app.post("/updateuser", async (req, res) => {
    try {
        const shop = req.query.shop;

        if (!shop) return res.status(400).json({ error: "Shop parameter missing" });

        if (!storeTokens[shop] && fs.existsSync(TOKEN_FILE)) {
            storeTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
        }

        const accessToken = storeTokens[shop];
        if (!accessToken) return res.status(401).json({ error: "Shop not authenticated" });

        const query = `
            mutation customerCreate($input: CustomerInput!) {
                customerCreate(input: $input) {
                    customer {
                        id
                        email
                        firstName
                        lastName
                        phone
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;

        const variables = { input: { firstName, lastName, email, phone } };

        const response = await axios.post(
            `https://${shop}/admin/api/2025-01/customers.json`,
            { query, variables },
            {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json"
                }
            }
        );
        const responseData = response.data;
        console.log("Shopify Response:", JSON.stringify(responseData, null, 2));

        if (responseData.data.customerCreate.userErrors.length > 0) {
            return res.status(400).json({ error: responseData.data.customerCreate.userErrors });
        }

        res.json({ success: true, customer: responseData.data.customerCreate.customer });

    } catch (error) {
        console.error("GraphQL Error:", error.response?.data || error.message);
        res.status(500).json({ error: "Failed to create customer." });
    }
});

app.listen(PORT, () => {
    console.log(`App running on ${NGROK_URL}`);
});
