import express, { Request, Response } from "express";
import cors from "cors";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import QRCode from "qrcode";
import axios from "axios";
import FormData from "form-data";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Provider + Wallet
if (!process.env.GANACHE_RPC) throw new Error("GANACHE_RPC missing in .env");
if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY missing in .env");
if (!process.env.CONTRACT_ADDRESS)
  throw new Error("CONTRACT_ADDRESS missing in .env");

const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Load Contract ABI
const artifactPath = path.join(
  __dirname,
  "..",
  "..",
  "Contracts",
  "artifacts",
  "contracts",
  "PharmaTrustChain.sol",
  "PharmaTrustChain.json"
);

if (!fs.existsSync(artifactPath)) {
  throw new Error(`Artifact not found at: ${artifactPath}`);
}

const contractJson = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const contractABI = contractJson.abi;

const contract = new ethers.Contract(
  process.env.CONTRACT_ADDRESS,
  contractABI,
  wallet
);

// --------------------------------
// Helper: Upload to Pinata IPFS
// --------------------------------
const pinataJWT = process.env.PINATA_JWT;
if (!pinataJWT) throw new Error("PINATA_JWT missing in .env");

async function uploadToIPFS(product: any) {
  try {
    const buffer = Buffer.from(JSON.stringify(product));

    const formData = new FormData();
    formData.append("file", buffer, { filename: "metadata.json" });

    const response = await axios.post(
      "https://api.pinata.cloud/pinning/pinFileToIPFS",
      formData,
      {
        headers: {
          Authorization: `Bearer ${pinataJWT}`,
          ...formData.getHeaders(),
        },
      }
    );

    console.log("✅ Uploaded to IPFS (Pinata):", response.data);
    return response.data; // Contains IpfsHash
  } catch (error: any) {
    console.error(
      "❌ Upload to IPFS (Pinata) failed:",
      error.response?.data || error.message
    );
    throw error;
  }
}

// -------------------------------
// Routes
// -------------------------------

// Verify batch

app.get("/verify/:batchId", async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params;

    // Your existing verification logic
    const data = await contract.verifyBatch(batchId);

    // Generate QR Code dynamically
    const qrCode = await QRCode.toDataURL(batchId);

    res.json({
      valid: data.valid,
      owner: data.owner,
      revoked: data.revoked,
      history: data.history,
      qrCode, 
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Register product
app.post("/register-product", async (req: Request, res: Response) => {
  const { name, batchId, details } = req.body;
  if (!name || !batchId || !details) {
    return res
      .status(400)
      .json({ error: "Missing fields: name, batchId, details" });
  }

  try {
    // 1. Upload product metadata to Pinata
    const ipfsResponse = await uploadToIPFS(details);
    const ipfsHash = ipfsResponse.IpfsHash; // ✅ Pinata returns IpfsHash

    // 2. Call smart contract to register product
    const tx = await contract.registerProduct(name, batchId, ipfsHash);
    await tx.wait();

    // 3. Generate QR Code with verify link
    const verifyUrl = `${process.env.FRONTEND_URL}/verify/${batchId}`;
    const qrCodeData = await QRCode.toDataURL(verifyUrl);

    res.json({
      txHash: tx.hash,
      ipfsHash,
      verifyUrl,
      qrCode: qrCodeData, // base64 image
    });
  } catch (err: any) {
    console.error("Register error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Transfer ownership
app.post("/transfer-ownership", async (req: Request, res: Response) => {
  const { batchId, newOwner } = req.body;
  if (!batchId || !newOwner) {
    return res.status(400).json({ error: "Missing batchId or newOwner" });
  }

  try {
    const tx = await contract.transferOwnership(batchId, newOwner);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err: any) {
    console.error("Transfer error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Revoke batch
app.post("/revoke-batch", async (req: Request, res: Response) => {
  const { batchId } = req.body;
  if (!batchId) {
    return res.status(400).json({ error: "Missing batchId" });
  }

  try {
    const tx = await contract.revokeBatch(batchId); 
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err: any) {
    console.error("Revoke error:", err);
    res.status(500).json({ error: err.message });
  }
});


// -------------------------------
// User Signup
// -------------------------------
app.post("/signup", async (req: Request, res: Response) => {
  try {
    const { username, password, role } = req.body;

    if (!username || !password || !role) {
      return res.status(400).json({ error: "All fields are required" });
    }

    // Hash password before storing (to avoid plain text on-chain, optional)
    const passwordHash = ethers.id(password); // keccak256 hash

    // Call smart contract
    const tx = await contract.registerUser(username, passwordHash, role);
    await tx.wait();

    res.json({ success: true, message: "User registered successfully" });
  } catch (err: any) {
    console.error("❌ Signup error:", err);

    // Try to extract a readable reason
    const reason =
      err.reason || err.data?.message || err.message || "Signup failed";

    res.status(500).json({ error: reason });
  }
});

// -------------------------------
// User Login
// -------------------------------
app.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const passwordHash = ethers.id(password);

    // Call smart contract
    const user = await contract.login(username, passwordHash);

    if (!user.exists) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    res.json({
      success: true,
      message: "Login successful",
      user: {
        username,
        role: user.role,
        wallet: user.wallet,
      },
    });
  } catch (err: any) {
    console.error("❌ Login error:", err);

    const reason =
      err.reason || err.data?.message || err.message || "Login failed";

    res.status(500).json({ error: reason });
  }
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Backend running at http://localhost:${PORT}`)
);
