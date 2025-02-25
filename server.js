import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import cors from 'cors';
import { GraphQLClient, gql } from 'graphql-request';

const app = express();
app.use(express.json());
app.use(cors());

// app.get('/getproducts', async (req, res) => {
//     const query = `
//     {
//      products(first: 5) {
//                         edges {
//                             node {
//                                 id
//                                 title
//                                 variants(first: 1) {
//                                     edges {
//                                         node {
//                                             price
//                                         }
//                                     }
//                                 }
//                             }
//                         }
//                     }
//                 }   
//   `;

//     try {
//         const response = await axios.post(
//             `https://${process.env.STORE}/admin/api/2024-07/graphql.json`,
//             { query },
//             {
//                 headers: {
//                     "X-Shopify-Access-Token": process.env.ACCESS_TOKEN,
//                     "Content-Type": "application/json",
//                 },
//             }
//         );
//         res.json({ message: "Products fetched successfully", products: response.data });
//     } catch (error) {
//         console.error("Error fetching products:", error.response?.data || error.message);
//         res.status(500).json({ error: "Failed to fetch products" });
//     }
// });


// With GRAPHQL Client query fetching 

// Rate Limit
// Graphql and rest api limitatations


const client = new GraphQLClient(
  `https://${process.env.STORE}/admin/api/2025-01/graphql.json`,
  {
    headers: {
      "X-Shopify-Access-Token": process.env.ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
  }
);


const UPDATE_PRICE_MUTATION = gql`
  mutation UpdateProductVariant($id: ID!, $price: Money!) {
    productVariantUpdate(input: { id: $id, price: $price }) {
      productVariant {
        id
        title
        price
      }
      userErrors {
        field
        message
      }
    }
  }
`;

app.post('/updateprice', async (req, res) => {
  try {
    const { variantId, newPrice } = req.body;

    if (!variantId || !newPrice) {
      return res.status(400).json({ error: "Missing variantId or newPrice in request body" });
    }

    const variables = {
      id: variantId,
      price: newPrice
    };

    const response = await client.request(UPDATE_PRICE_MUTATION, variables);

    if (response.productVariantUpdate.userErrors.length > 0) {
      return res.status(400).json({ error: response.productVariantUpdate.userErrors });
    }

    res.json({ message: "Price updated successfully", updatedVariant: response.productVariantUpdate.productVariant });
  } catch (error) {
    console.error("Error updating product price:", error);
    res.status(500).json({ error: "Failed to update product price" });
  }
});

const GET_PRODUCTS_QUERY = gql`
  query GetProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          variants(first: 3) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
              }
            }
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

app.get('/getproducts', async (req, res) => {
  try {
    const variables = { first: req.body.first };
    const response = await client.request(GET_PRODUCTS_QUERY, variables);
    res.json({
      message: "Products fetched successfully", products: response.products, pagination: {
        hasNextPage: response.products.pageInfo.hasNextPage,
        endCursor: response.products.pageInfo.endCursor
      }
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

const CREATE_CUSTOMER_MUTATION = `
  mutation customerCreate($input: CustomerInput!) {
    customerCreate(input: $input) {
      customer {
        id
        firstName
        lastName
        email
        createdAt
      }
      userErrors {
        field
        message
      }
    }
  }
`;

app.post('/createcustomer', async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body;

    if (!firstName || !lastName || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const variables = {
      input: {
        firstName,
        lastName,
        email
      }
    };

    const response = await client.request(CREATE_CUSTOMER_MUTATION, variables);

    if (response.customerCreate.userErrors.length > 0) {
      return res.status(400).json({ error: response.customerCreate.userErrors });
    }

    res.json({
      message: "Customer created successfully",
      customer: response.customerCreate.customer
    });

  } catch (error) {
    console.error("Error creating customer:", error);
    res.status(500).json({ error: "Failed to create customer" });
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
      address: "https://my-auth-app.com/webhooks/uninstall",
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


app.listen(3000, () => console.log(`GraphQL Server running on http://localhost:3000`));