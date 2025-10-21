import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import fetch from "node-fetch";
import {
  Sequelize,
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// -------------------- ENV VARIABLES --------------------
const GANACHE_RPC = process.env.GANACHE_RPC || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PORT = Number(process.env.PORT || 5000);

// -------------------- DATABASE (SQLite + Sequelize) --------------------
const sequelize = new Sequelize({
  dialect: "sqlite",
  storage: path.join(__dirname, "../pharmadb.sqlite"),
  logging: false,
});

// -------------------- MODELS --------------------

// User = application users who sign up and later get approved
class User extends Model<
  InferAttributes<User>,
  InferCreationAttributes<User>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare role: number; // 1=Manufacturer,2=Distributor,3=Pharmacy
  declare walletAddress: string;
  declare licenseNumber: string;
  declare status: string; // pending | approved | rejected
}

User.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.INTEGER, allowNull: false },
    walletAddress: { type: DataTypes.STRING, allowNull: false, unique: true },
    licenseNumber: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
  },
  { sequelize, modelName: "User", timestamps: false }
);

// PpbUser = mock PPB registry
class PPBRecord extends Model<
  InferAttributes<PPBRecord>,
  InferCreationAttributes<PPBRecord>
> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare email: string;
  declare licenseNumber: string;
  declare role: number;
}

PPBRecord.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING, allowNull: false },
    email: { type: DataTypes.STRING, allowNull: false },
    licenseNumber: { type: DataTypes.STRING, allowNull: false, unique: true },
    role: { type: DataTypes.INTEGER, allowNull: false },
  },
  { sequelize, modelName: "PPBRecord", timestamps: false }
);

// -------------------- BLOCKCHAIN SETUP --------------------
const contractPath = path.join(__dirname, "../contracts/PharmaTrustChain.json");
if (!fs.existsSync(contractPath)) {
  console.error("ERROR: Contract ABI missing at", contractPath);
  process.exit(1);
}

const contractJson = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const contractABI = contractJson.abi;

const provider = new ethers.JsonRpcProvider(GANACHE_RPC);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);

// -------------------- HELPERS --------------------
function isValidAddress(a: string): boolean {
  try {
    return ethers.isAddress(a);
  } catch {
    return false;
  }
}

// -------------------- ROUTES --------------------

// ✅ SIGNUP
app.post("/signup", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, role, walletAddress, licenseNumber } = req.body;

    if (!walletAddress) {
      res.status(400).json({ message: "Wallet address required" });
      return;
    }

    // Check existing user
    const existingUser = await User.findOne({ where: { walletAddress } });
    if (existingUser) {
      res
        .status(400)
        .json({ message: "User already registered locally. Please log in." });
      return;
    }

    // Check PPB registry
    const licenseExists = await PPBRecord.findOne({ where: { licenseNumber } });
    if (!licenseExists) {
      res.status(400).json({ message: "License number not found in PPB database" });
      return;
    }

    // Save pending user
    await User.create({
      name,
      email,
      role,
      walletAddress,
      licenseNumber,
      status: "pending",
    });

    res.json({
      success: true,
      message: "Registration pending verification by admin",
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// ✅ LOGIN
app.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { walletAddress } = req.body;
    const user = await User.findOne({
      where: { walletAddress, status: "approved" },
    });

    if (!user) {
      res.status(404).json({ error: "User not found or not approved" });
      return;
    }

    res.json({ success: true, user });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// ✅ ADMIN - Pending requests
app.get("/pending-requests", async (_req: Request, res: Response): Promise<void> => {
  try {
    const pending = await User.findAll({ where: { status: "pending" } });
    res.json({ success: true, data: pending });
  } catch (err) {
    console.error("Fetch error:", err);
    res.status(500).json({ error: "Failed to fetch pending requests" });
  }
});

// ✅ ADMIN - Approve
app.post("/approve-request/:wallet", async (req: Request, res: Response): Promise<void> => {
  try {
    const walletAddress = req.params.wallet;
    const user = await User.findOne({ where: { walletAddress, status: "pending" } });

    if (!user) {
      res.status(404).json({ error: "User not found or already processed" });
      return;
    }

    const tx = await contract.registerUser(
      user.walletAddress,
      user.name,
      Number(user.role)
    );
    await tx.wait();

    user.status = "approved";
    await user.save();

    res.json({ success: true, message: "User approved and registered on chain" });
  } catch (err: any) {
    console.error("Approval error:", err);
    res.status(500).json({ error: err.message || "Failed to approve user" });
  }
});

// ✅ ADMIN - Reject
app.post("/reject-request/:wallet", async (req: Request, res: Response): Promise<void> => {
  try {
    const walletAddress = req.params.wallet;
    const user = await User.findOne({ where: { walletAddress, status: "pending" } });

    if (!user) {
      res.status(404).json({ error: "User not found or already processed" });
      return;
    }

    await user.destroy();
    res.json({ success: true, message: "User registration rejected" });
  } catch (err) {
    console.error("Rejection error:", err);
    res.status(500).json({ error: "Failed to reject user" });
  }
});


// ✅ FETCH ALL BATCHES (for frontend use)
app.get("/batches", async (_req: Request, res: Response): Promise<void> => {
  try {
    const batches = await contract.getAllBatches();

const formatted = batches.map((b: any) => ({
  id: b.id?.toString(),
  name: b.name,
  batchNumber: b.batchNumber,
  ipfsHash: b.ipfsHash,
  manufacturer: b.manufacturer,
  currentOwner: b.currentOwner,
  revoked: b.revoked,
  timestamp: b.timestamp?.toString(),
  revokeReason: b.revokeReason,
}));
    res.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error("Error fetching batches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch batches from blockchain",
      error: error.message,
    });
  }
});


// ✅ Mock PPB API
app.get("/api/ppb", async (_req: Request, res: Response): Promise<void> => {
  try {
    const records = await PPBRecord.findAll();
    res.json({ success: true, data: records });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch PPB records" });
  }
});

// ✅ Check user status (used by frontend polling)
app.get("/api/user-status/:wallet", async (req: Request, res: Response): Promise<void> => {
  try {
    const { wallet } = req.params;
    const user = await User.findOne({ where: { walletAddress: wallet } });

    if (!user) {
      res.status(404).json({ status: "not_found" });
      return;
    }

    res.json({ status: user.status });
  } catch (error) {
    console.error("User status check error:", error);
    res.status(500).json({ error: "Failed to check user status" });
  }
});

// ---------- PINATA UPLOAD (pins JSON metadata) ----------
app.post("/pinata/upload", async (req: Request, res: Response) => {
  try {
    const metadata = req.body.metadata ?? req.body;
    const PINATA_JWT = process.env.PINATA_JWT;

    if (!PINATA_JWT) {
      return res.status(500).json({ error: "Pinata JWT not configured on server" });
    }

    const pinataEndpoint = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
    const response = await fetch(pinataEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataMetadata: { name: metadata.name ?? `batch-${Date.now()}` },
        pinataContent: metadata,
      }),
    });
    if (!response.ok) {
      const text = await response.text();
      console.error("Pinata error:", text);
      return res.status(500).json({ error: "Pinata upload failed", details: text });
    }

    const raw = await response.json();

    if (typeof raw !== "object" || raw === null) {
      return res.status(500).json({ error: "Invalid Pinata response", raw });
    }

    const ipfsHash =
      (raw as any).IpfsHash ||
      (raw as any).ipfsHash ||
      null;

    if (!ipfsHash) {
      console.error("Pinata response missing hash:", raw);
      return res.status(500).json({ error: "Pinata response missing hash", raw });
    }

    res.json({ success: true, ipfsHash });
  } catch (err: any) {
    console.error("Pinata upload error:", err);
    res.status(500).json({ error: err.message || "Pinata upload failed" });
  }
});

//get manufacturers batches
app.get("/manufacturer/batches", async (req: express.Request, res: express.Response) => {
  try {
    const { walletAddress } = req.query as { walletAddress?: string };

    if (!walletAddress) {
      return res.status(400).json({ success: false, message: "Missing wallet address" });
    }

    

    // Use the globally defined contract instance
    const batches = await contract.getBatchesByManufacturer(walletAddress);

    // Format and return the data
   const formatted = batches.map((batch: any) => ({
  id: batch.id?.toString(),
  name: batch.name,
  batchNumber: batch.batchNumber,
  ipfsHash: batch.ipfsHash,
  manufacturer: batch.manufacturer,
  currentOwner: batch.currentOwner,
  revoked: batch.revoked,         // ✅ property name matches frontend
  revokeReason: batch.revokeReason, // ✅ include reason
  timestamp: Number(batch.timestamp),
}));
res.json({ success: true, data: formatted });

  } catch (error) {
    console.error("Error fetching manufacturer batches:", error);
    res.status(500).json({ success: false, message: "Error fetching manufacturer batches" });
  }
});


// GET /admin/all-batches  -> reads all batches from contract (returns array)
app.get("/admin/all-batches", async (_req: Request, res: Response): Promise<void> => {
  try {
    // call contract.getAllBatches()
    const raw = await contract.getAllBatches();
    // raw is an array of tuple/structs; transform to plain objects
    const batches = raw.map((b: any) => ({
      id: Number(b.id.toString ? b.id.toString() : b.id),
      name: b.name,
      batchNumber: b.batchNumber,
      ipfsHash: b.ipfsHash,
      manufacturer: b.manufacturer,
      currentOwner: b.currentOwner,
      revoked: !!b.revoked,
      timestamp: Number(b.timestamp?.toString ? b.timestamp.toString() : b.timestamp),
      revokeReason: b.revokeReason || "",
    }));
    res.json({ success: true, data: batches });
  } catch (err: any) {
    console.error("Fetch all batches error:", err);
    res.status(500).json({ error: err.message || "Failed to fetch batches" });
  }
});

// POST /admin/revoke/:id  -> server wallet calls contract.revokeBatch(batchId, reason)
app.post("/revoke-batch/:id", async (req: Request, res: Response): Promise<void> => {
  try {
    const batchIdRaw = req.params.id;
    const reason = req.body.reason ?? "Revoked by admin";
    const batchId = Number(batchIdRaw);
    if (!batchId || batchId <= 0) {
      res.status(400).json({ error: "Invalid batch id" });
      return;
    }

    const tx = await contract.revokeBatch(batchId, reason);
    await tx.wait();

    res.json({ success: true, message: "Batch revoked on chain" });
  } catch (err: any) {
    console.error("Revoke batch error:", err);
    res.status(500).json({ error: err.message || "Failed to revoke batch" });
  }
});

// GET /user/:wallet
app.get("/user/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const user = await User.findOne({ where: { walletAddress: wallet } });

    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    res.json({ success: true, data: user });
  } catch (error: any) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -------------------- START SERVER --------------------
(async () => {
  try {
    await sequelize.sync();

    // Seed mock PPB records
    const count = await PPBRecord.count();
    if (count === 0) {
      const sample = [];
      for (let i = 1; i <= 20; i++) {
        sample.push({
          name: `Verified Entity ${i}`,
          email: `verified${i}@example.com`,
          licenseNumber: `PPB-${1000 + i}`,
          role: ((i - 1) % 3) + 1,
        });
      }
      await PPBRecord.bulkCreate(sample);
      console.log("✅ Seeded 20 mock PPB registry entries.");
    }

    app.listen(PORT, () => {
      console.log(`✅ Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Server start error:", err);
    process.exit(1);
  }
})();
