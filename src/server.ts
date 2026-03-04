import express, { Request, Response } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { ethers, Wallet } from "ethers";
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
import { error } from "console";
import axios from "axios";
import dayjs from "dayjs";

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
class User extends Model<InferAttributes<User>, InferCreationAttributes<User>> {
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
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
  },
  { sequelize, modelName: "User", timestamps: false },
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
  { sequelize, modelName: "PPBRecord", timestamps: false },
);

// -------------------- ORDER & AUDIT MODELS --------------------

class Order extends Model<
  InferAttributes<Order>,
  InferCreationAttributes<Order>
> {
  declare id: CreationOptional<number>;
  declare batchId: number;
  declare seller: string;
  declare buyer: string;
  declare price: number | null;
  declare status: string;
  declare txHash: string | null;
  declare contact: string | null;
  declare quantity: number | null;

  // 🆕 Optional field
  declare ownershipTransferred?: boolean | null;
}

Order.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    batchId: { type: DataTypes.INTEGER, allowNull: false },
    seller: { type: DataTypes.STRING, allowNull: false },
    buyer: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: true },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    txHash: { type: DataTypes.STRING, allowNull: true },
    contact: { type: DataTypes.STRING, allowNull: true },
    ownershipTransferred: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
      validate: {
        min: 1,
      },
    },
  },
  { sequelize, modelName: "Order", timestamps: true },
);

// Audit trail
class AuditTrail extends Model<
  InferAttributes<AuditTrail>,
  InferCreationAttributes<AuditTrail>
> {
  declare id: CreationOptional<number>;
  declare orderId: number;
  declare batchId: number;
  declare from: string;
  declare to: string;
  declare action: string;
  declare txHash: string | null;
}

AuditTrail.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    orderId: { type: DataTypes.INTEGER, allowNull: false },
    batchId: { type: DataTypes.INTEGER, allowNull: false },
    from: { type: DataTypes.STRING, allowNull: false },
    to: { type: DataTypes.STRING, allowNull: false },
    action: { type: DataTypes.STRING, allowNull: false },
    txHash: { type: DataTypes.STRING, allowNull: true },
  },
  { sequelize, modelName: "AuditTrail", timestamps: true },
);

// Helper to create audit entry
interface AuditEntryInput {
  orderId: number;
  batchId: number;
  from: string;
  to: string;
  action: string;
  txHash?: string | null; // optional
}

async function createAuditEntry(entry: AuditEntryInput) {
  await AuditTrail.create(entry);
}

// models/PharmacyOrder.ts

class PharmacyOrder extends Model<
  InferAttributes<PharmacyOrder>,
  InferCreationAttributes<PharmacyOrder>
> {
  declare id: CreationOptional<number>;
  declare batchId: number;
  declare distributor: string;
  declare pharmacy: string;
  declare price: number | null;
  declare status: string; // pending | seller_confirmed | paid | completed | cancelled
  declare txHash: string | null;
  declare ownershipTransferred?: boolean | null;
  declare contact?: string | null;
  declare quantity: number | null;
  declare checkoutRequestId?: string | null;
}

PharmacyOrder.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    batchId: { type: DataTypes.INTEGER, allowNull: false },
    distributor: { type: DataTypes.STRING, allowNull: false },
    pharmacy: { type: DataTypes.STRING, allowNull: false },
    price: { type: DataTypes.FLOAT, allowNull: true },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "pending",
    },
    txHash: { type: DataTypes.STRING, allowNull: true },
    ownershipTransferred: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false,
    },
    contact: { type: DataTypes.STRING, allowNull: true },
    quantity: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1,
    },
    checkoutRequestId: { type: DataTypes.STRING, allowNull: true },
  },
  { sequelize, modelName: "PharmacyOrder", timestamps: true },
);

// Stock Management

export class Stock extends Model<
  InferAttributes<Stock>,
  InferCreationAttributes<Stock>
> {
  declare id: CreationOptional<number>;
  declare batchId: number;
  declare ownerWallet: string;
  declare role: number; // 1=Manufacturer, 2=Distributor, 3=Pharmacy
  declare quantity: number; // boxes
  declare status: string; // active | frozen
}

Stock.init(
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    batchId: { type: DataTypes.INTEGER, allowNull: false },
    ownerWallet: { type: DataTypes.STRING, allowNull: false },
    role: { type: DataTypes.INTEGER, allowNull: false },
    quantity: { type: DataTypes.INTEGER, allowNull: false },
    status: {
      type: DataTypes.STRING,
      allowNull: false,
      defaultValue: "active",
    },
  },
  { sequelize, modelName: "Stock", timestamps: true },
);

// Payment

export class Payment extends Model {}

Payment.init(
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
    },
    orderId: { type: DataTypes.UUID, allowNull: false },
    payerWallet: { type: DataTypes.STRING, allowNull: false },
    payeeWallet: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    phone: { type: DataTypes.STRING, allowNull: false },
    method: { type: DataTypes.STRING, defaultValue: "MPESA" },
    checkoutRequestId: { type: DataTypes.STRING, allowNull: true },
    mpesaReceipt: { type: DataTypes.STRING, allowNull: true },
    status: {
      type: DataTypes.ENUM("PENDING", "SUCCESS", "FAILED"),
      defaultValue: "PENDING",
    },
    rawCallback: { type: DataTypes.TEXT, allowNull: true },
  },
  {
    sequelize,
    tableName: "payments",
  },
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
app.post("/signup", async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, role, walletAddress, licenseNumber } = req.body;

    if (!walletAddress) {
      res.status(400).json({ message: "Wallet address required" });
      return;
    }

    const existingUser = await User.findOne({ where: { walletAddress } });
    if (existingUser) {
      res.status(400).json({
        message: "User already registered locally. Please log in.",
      });
      return;
    }

    const ppbRecord = await PPBRecord.findOne({ where: { licenseNumber } });
    if (!ppbRecord) {
      res.status(400).json({
        success: false,
        message: "❌ License number not found in PPB database.",
      });
      return;
    }

    const nameMatch =
      ppbRecord.name.trim().toLowerCase() === name.trim().toLowerCase();
    const emailMatch =
      ppbRecord.email.trim().toLowerCase() === email.trim().toLowerCase();
    const roleMatch = ppbRecord.role === Number(role);

    if (!nameMatch || !emailMatch || !roleMatch) {
      res.status(400).json({
        success: false,
        message:
          "❌ Submitted details do not match PPB registry record. Check your name, email or role again !!!",
        registryRecord: ppbRecord,
      });
      return;
    }

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
      message:
        "✅ Registration verified with PPB registry. Awaiting admin approval.",
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// LOGIN
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

//ADMIN - Pending requests
app.get(
  "/pending-requests",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const pending = await User.findAll({ where: { status: "pending" } });
      res.json({ success: true, data: pending });
    } catch (err) {
      console.error("Fetch error:", err);
      res.status(500).json({ error: "Failed to fetch pending requests" });
    }
  },
);

// ADMIN - Approve
app.post(
  "/approve-request/:wallet",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const walletAddress = req.params.wallet;
      const user = await User.findOne({
        where: { walletAddress, status: "pending" },
      });

      if (!user) {
        res.status(404).json({ error: "User not found or already processed" });
        return;
      }

      const tx = await contract.registerUser(
        user.walletAddress,
        user.name,
        Number(user.role),
      );
      await tx.wait();

      user.status = "approved";
      await user.save();

      res.json({
        success: true,
        message: "User approved and registered on chain",
      });
    } catch (err: any) {
      console.error("Approval error:", err);
      res.status(500).json({ error: err.message || "Failed to approve user" });
    }
  },
);

// ADMIN - Reject
app.post(
  "/reject-request/:wallet",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const walletAddress = req.params.wallet;
      const user = await User.findOne({
        where: { walletAddress, status: "pending" },
      });

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
  },
);

// FETCH ALL BATCHES (for frontend use)
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

// Mock PPB API
app.get("/api/ppb", async (_req: Request, res: Response): Promise<void> => {
  try {
    const records = await PPBRecord.findAll();
    res.json({ success: true, data: records });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to fetch PPB records" });
  }
});

//Check user status (used by frontend polling)
app.get(
  "/api/user-status/:wallet",
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

// ---------- PINATA UPLOAD (pins JSON metadata) ----------
app.post("/pinata/upload", async (req: Request, res: Response) => {
  try {
    const metadata = req.body.metadata ?? req.body;
    const PINATA_JWT = process.env.PINATA_JWT;

    if (!PINATA_JWT) {
      return res
        .status(500)
        .json({ error: "Pinata JWT not configured on server" });
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
      return res
        .status(500)
        .json({ error: "Pinata upload failed", details: text });
    }

    const raw = await response.json();

    if (typeof raw !== "object" || raw === null) {
      return res.status(500).json({ error: "Invalid Pinata response", raw });
    }

    const ipfsHash = (raw as any).IpfsHash || (raw as any).ipfsHash || null;

    if (!ipfsHash) {
      console.error("Pinata response missing hash:", raw);
      return res
        .status(500)
        .json({ error: "Pinata response missing hash", raw });
    }

    res.json({ success: true, ipfsHash });
  } catch (err: any) {
    console.error("Pinata upload error:", err);
    res.status(500).json({ error: err.message || "Pinata upload failed" });
  }
});

//get manufacturers batches
app.get(
  "/manufacturer/batches",
  async (req: express.Request, res: express.Response) => {
    try {
      const { walletAddress } = req.query as { walletAddress?: string };

      if (!walletAddress) {
        return res
          .status(400)
          .json({ success: false, message: "Missing wallet address" });
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
        revoked: batch.revoked, // ✅ property name matches frontend
        revokeReason: batch.revokeReason, // ✅ include reason
        timestamp: Number(batch.timestamp),
      }));
      res.json({ success: true, data: formatted });
    } catch (error) {
      console.error("Error fetching manufacturer batches:", error);
      res.status(500).json({
        success: false,
        message: "Error fetching manufacturer batches",
      });
    }
  },
);

// GET /admin/all-batches  -> reads all batches from contract (returns array)
app.get(
  "/admin/all-batches",
  async (_req: Request, res: Response): Promise<void> => {
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
        timestamp: Number(
          b.timestamp?.toString ? b.timestamp.toString() : b.timestamp,
        ),
        revokeReason: b.revokeReason || "",
      }));
      res.json({ success: true, data: batches });
    } catch (err: any) {
      console.error("Fetch all batches error:", err);
      res.status(500).json({ error: err.message || "Failed to fetch batches" });
    }
  },
);

// POST /admin/revoke/:id  -> server wallet calls contract.revokeBatch(batchId, reason)
app.post(
  "/revoke-batch/:id",
  async (req: Request, res: Response): Promise<void> => {
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
  },
);

// GET /user/:wallet
app.get("/user/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet;
    const user = await User.findOne({ where: { walletAddress: wallet } });

    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    res.json({ success: true, data: user });
  } catch (error: any) {
    console.error("Error fetching user:", error);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -------------------- ORDER / PAYMENT ROUTES --------------------

// POST /orders/confirm
app.post("/orders/confirm", async (req: Request, res: Response) => {
  try {
    const { orderId, amount } = req.body;

    if (!orderId || !amount || amount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payload" });
    }

    // Find the order by ID
    const order = await Order.findByPk(orderId);
    if (!order) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    // Only allow confirming orders in "pending" status
    if (order.status !== "pending") {
      return res
        .status(400)
        .json({ success: false, message: "Order cannot be confirmed" });
    }

    // Update order details
    order.price = amount;
    order.status = "awaiting_payment";

    await order.save();

    // Optional: create an audit entry if you have audit logging
    await createAuditEntry({
      orderId: order.id as number,
      batchId: order.batchId,
      from: order.seller,
      to: order.buyer,
      action: "order_confirmed",
    });
    res.json({
      success: true,
      message: "Order confirmed successfully!",
      order,
    });
  } catch (err: any) {
    console.error("Confirm order error:", err);
    res.status(500).json({
      success: false,
      message: err.message || "Failed to confirm order",
    });
  }
});

// View distibutors Stock
app.get("/stock/distributor/:wallet", async (req: Request, res: Response) => {
  console.log("triggerred");
  try {
    const wallet = (req.params.wallet || "").toLowerCase();

    const stock = await Stock.findAll({
      where: { ownerWallet: wallet, role: 2 }, // 2 = Distributor
    });

    res.json({ success: true, data: stock });
  } catch (err: any) {
    console.error("Error fetching distributor stock:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Create new order
app.post(
  "/orders/create",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { batchId, buyer, seller, status, contact, quantity } = req.body;
      const orderQuantity = Number(quantity) > 0 ? Number(quantity) : 1;

      if (!batchId || !buyer || !seller) {
        res
          .status(400)
          .json({ success: false, message: "Missing required fields." });
        return;
      }

      const existingOrder = await Order.findOne({
        where: {
          batchId,
          buyer,
          status: ["pending", "awaiting_payment"],
        },
      });

      if (existingOrder) {
        res.status(400).json({
          success: false,
          message: "You already have an active order for this batch.",
        });
        return;
      }

      const newOrder = await Order.create({
        batchId,
        buyer,
        seller,
        status: status || "pending",
        contact: contact || null,
        quantity: orderQuantity,
      });

      res.json({
        success: true,
        message: "Order placed successfully!",
        data: newOrder,
      });
    } catch (err) {
      console.error("Error creating order:", err);
      res.status(500).json({
        success: false,
        message: "Error creating order.",
      });
    }
  },
);

// GET /orders/manufacturer/:wallet
app.get("/orders/manufacturer/:wallet", async (req: Request, res: Response) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase().trim();
    if (!wallet) {
      return res
        .status(400)
        .json({ success: false, message: "Missing wallet address" });
    }

    const orders = await Order.findAll({
      where: Sequelize.where(
        Sequelize.fn("lower", Sequelize.col("seller")),
        wallet,
      ),
    });
    res.json({ success: true, data: orders });
  } catch (err: any) {
    console.error("Fetch manufacturer orders error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch orders",
      error: err.message,
    });
  }
});

// ✅ Get all awaiting-payment orders for a distributor
app.get(
  "/orders/distributor/:wallet/awaiting",
  async (req: Request, res: Response) => {
    try {
      const wallet = (req.params.wallet || "").toLowerCase().trim();
      if (!wallet) {
        return res
          .status(400)
          .json({ success: false, message: "Missing wallet address" });
      }

      const orders = await Order.findAll({
        where: { status: "awaiting_payment" },
        order: [["createdAt", "DESC"]],
      });

      const filtered = orders.filter(
        (order) => order.buyer.toLowerCase() === wallet,
      );

      if (filtered.length === 0) {
        return res.json({ success: true, data: [] });
      }

      res.json({ success: true, data: filtered });
    } catch (err: any) {
      console.error("Error fetching awaiting payment orders:", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch awaiting payment orders",
        error: err.message,
      });
    }
  },
);

//Fetch distributor Batches
app.get("/batches/distributor/:wallet", async (req, res) => {
  try {
    const wallet = req.params.wallet.toLowerCase();

    // 🔹 1. Fetch all blockchain batches
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

    // 🔹 2. Fetch ownershipTransferred orders
    const transferredOrders = await Order.findAll({
      where: { ownershipTransferred: true },
      attributes: ["batchId"],
    });

    const transferredIds = transferredOrders.map((o) => o.batchId?.toString());

    // 🔹 3. Filter logic:
    // (A) Batches available from manufacturers (unsold)
    const availableBatches = formatted.filter(
      (b: any) =>
        !b.revoked &&
        !transferredIds.includes(b.id) &&
        b.currentOwner.toLowerCase() === b.manufacturer.toLowerCase(),
    );

    // (B) Batches owned by the distributor (already purchased)
    const ownedBatches = formatted.filter(
      (b: any) => b.currentOwner.toLowerCase() === wallet,
    );

    // 🔹 4. Merge and return unique list
    const combined = [
      ...availableBatches,
      ...ownedBatches.filter(
        (ob: any) => !availableBatches.some((ab: any) => ab.id === ob.id),
      ),
    ];

    res.json({ success: true, data: combined });
  } catch (error: any) {
    console.error("Error fetching distributor batches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch distributor batches",
      error: error.message,
    });
  }
});

// __________________________________________DISTRIBUTOR__MPESA____PAYMENT_____________________________________________

// Helper: generate M-Pesa access token
async function getMpesaAccessToken() {
  const { MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_ENV } = process.env;
  const auth = Buffer.from(
    `${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`,
  ).toString("base64");

  const url =
    MPESA_ENV === "sandbox"
      ? "https://sandbox.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials"
      : "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials";

  const res = await axios.get(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return res.data.access_token as string;
}

// Helper: initiate STK Push
async function initiateSTKPush(orderId: number, phone: string, amount: number) {
  const { MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_ENV } = process.env;
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY)
    throw new Error("Shortcode or Passkey not set in .env");

  const accessToken = await getMpesaAccessToken();
  const timestamp = dayjs().format("YYYYMMDDHHmmss");
  const password = Buffer.from(
    `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`,
  ).toString("base64");

  const stkUrl =
    MPESA_ENV === "sandbox"
      ? "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL:
      "https://nonvisible-lanette-unmelodised.ngrok-free.dev/orders/mpesa/callback",
    AccountReference: `Order-${orderId}`,
    TransactionDesc: `PharmaTrustChain Order ${orderId}`,
  };

  const res = await axios.post(stkUrl, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return res.data;
}
//Pharmacy : initiate STK Push

async function initiateSTKPushPharmacy(
  orderId: number,
  phone: string,
  amount: number,
) {
  const { MPESA_SHORTCODE, MPESA_PASSKEY, MPESA_ENV } = process.env;
  if (!MPESA_SHORTCODE || !MPESA_PASSKEY)
    throw new Error("Shortcode or Passkey not set in .env");

  const accessToken = await getMpesaAccessToken();
  const timestamp = dayjs().format("YYYYMMDDHHmmss");
  const password = Buffer.from(
    `${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`,
  ).toString("base64");

  const stkUrl =
    MPESA_ENV === "sandbox"
      ? "https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest"
      : "https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest";

  const payload = {
    BusinessShortCode: MPESA_SHORTCODE,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: phone,
    PartyB: MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL:
      "https://nonvisible-lanette-unmelodised.ngrok-free.dev/orders/mpesa/callback/pharmacy",
    AccountReference: `Pharmacy-Order-${orderId}`,
    TransactionDesc: `Pharmacy Order ${orderId}`,
  };

  const res = await axios.post(stkUrl, payload, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return res.data;
}

// -------------------- Distributor Pay Route --------------------
app.post("/orders/:id/pay", async (req, res) => {
  const { id } = req.params;
  const { phone } = req.body;

  if (!phone)
    return res
      .status(400)
      .json({ success: false, message: "Phone number required" });

  const transaction = await sequelize.transaction();

  try {
    const order = await Order.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    if (order.status !== "awaiting_payment") {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Order not awaiting payment" });
    }

    const amount = Number(order.price);
    if (!amount || amount <= 0) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ success: false, message: "Invalid order amount" });
    }

    // 1️⃣ Create Payment record
    const payment = await Payment.create(
      {
        orderId: order.id,
        payerWallet: order.buyer,
        payeeWallet: order.seller,
        phone,
        amount,
        method: "MPESA",
        status: "PENDING",
      },
      { transaction },
    );

    // 2️⃣ Initiate STK Push
    const stkResponse = await initiateSTKPush(order.id, phone, amount);

    // 3️⃣ Store CheckoutRequestID
    (payment as any).checkoutRequestId = stkResponse.CheckoutRequestID;
    await payment.save({ transaction });

    await transaction.commit();

    return res.json({
      success: true,
      message: "STK Push initiated. Check phone to complete payment.",
      data: stkResponse,
    });
  } catch (err) {
    console.error("Distributor Pay Error:", err);
    await transaction.rollback();
    return res
      .status(500)
      .json({ success: false, message: "Payment initiation failed" });
  }
});

app.post("/orders/mpesa/callback", async (req, res) => {

  try {
    const callback = req.body;
    const checkoutRequestId = callback.Body.stkCallback.CheckoutRequestID;
    const resultCode = callback.Body.stkCallback.ResultCode;
    const receipt = callback.Body.stkCallback.MpesaReceiptNumber;
    const items = callback.Body.stkCallback.CallbackMetadata?.Item as
      | { Name: string; Value: any }[]
      | undefined;
    const amount = items?.find((i) => i.Name === "Amount")?.Value;
    const payment = await Payment.findOne({ where: { checkoutRequestId } });
    if (!payment) return res.status(404).end();

    if (resultCode === 0) {
      (payment as any).status = "SUCCESS";
      (payment as any).mpesaReceipt = receipt;
      (payment as any).rawCallback = JSON.stringify(callback);
      await payment.save();
      await fulfillOrder((payment as any).orderId);
    } else {
      (payment as any).status = "FAILED";
      (payment as any).rawCallback = JSON.stringify(callback);
      await payment.save();
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).end();
  }
});

async function fulfillOrder(orderId: string) {
  const transaction = await sequelize.transaction();
  try {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!order) throw new Error("Order not found");

    // transfer ownership on-chain
    const tx = await contract.transferOwnership(order.batchId, order.buyer);
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Blockchain transfer failed");

    // stock reconciliation
    const qty = Number(order.quantity);

    // manufacturer → distributor
    const manufacturerStock = await Stock.findOne({
      where: {
        batchId: order.batchId,
        ownerWallet: order.seller.toLowerCase(),
        role: 1,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!manufacturerStock || manufacturerStock.quantity < qty)
      throw new Error("Insufficient manufacturer stock");

    await manufacturerStock.decrement({ quantity: qty }, { transaction });

    const distributorStock = await Stock.findOne({
      where: {
        batchId: order.batchId,
        ownerWallet: order.buyer.toLowerCase(),
        role: 2,
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (distributorStock) {
      await distributorStock.increment({ quantity: qty }, { transaction });
    } else {
      await Stock.create(
        {
          batchId: order.batchId,
          ownerWallet: order.buyer.toLowerCase(),
          role: 2,
          quantity: qty,
          status: "active",
        },
        { transaction },
      );
    }

    // finalize order
    order.status = "paid";
    order.ownershipTransferred = true;
    order.txHash = receipt.hash;
    await order.save({ transaction });

    // audit
    await AuditTrail.create(
      {
        orderId: order.id,
        batchId: order.batchId,
        from: order.seller,
        to: order.buyer,
        action: "MPESA_PAYMENT_CONFIRMED_AND_TRANSFERRED",
        txHash: receipt.hash,
      },
      { transaction },
    );
    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    console.error(err);
    throw err;
  }
}

app.post("/audit/batch-created", async (req, res) => {
  try {
    const { batchId, manufacturerWallet, txHash } = req.body;
    if (!batchId || !manufacturerWallet) {
      return res.status(400).json({
        success: false,
        message: "Missing batchId or manufacturerWallet",
      });
    }

    const audit = await AuditTrail.create({
      orderId: 0, // or null if not applicable
      batchId,
      from: "0x0000000000000000000000000000000000000000",
      to: manufacturerWallet,
      action: "BatchCreated",
      txHash: txHash || null, // <-- ✅ ensure txHash is saved
    });

    const { initialQuantity } = req.body;
    if (initialQuantity && initialQuantity > 0) {
      await Stock.create({
        batchId,
        ownerWallet: manufacturerWallet,
        role: 1,
        quantity: initialQuantity,
        status: "active",
      });
    }
    res.json({
      success: true,
      message: "Audit trail recorded successfully",
      data: audit,
    });
  } catch (err) {
    console.error("Error recording audit trail:", err);
    res.status(500).json({
      success: false,
      message: "Failed to record audit trail",
    });
  }
});

// stock Update route
app.get("/stock/manufacturer/:wallet", async (req: Request, res: Response) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    const stock = await Stock.findAll({
      where: { ownerWallet: wallet, role: 1 },
    });
    res.json({ success: true, data: stock });
  } catch (err: any) {
    console.error("Error fetching manufacturer stock:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// order confrimation
app.get("/orders/:id/status", async (req, res) => {
  try {
    const order = await Order.findByPk(req.params.id);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    res.json({ success: true, data: { status: order.status } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// 🧾 Fetch all audit logs (admin sees everything)
app.get("/audit", async (req, res) => {
  try {
    const audits = await AuditTrail.findAll({
      order: [["createdAt", "DESC"]],
    });
    res.json({ success: true, data: audits });
  } catch (err) {
    console.error("⚠️ Error fetching audit logs:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch audit logs" });
  }
});

// ______________________________Pharmacy_Routes______________________________________________

// 1. Get all batches currently owned by any distributor (for pharmacy to browse)
app.get("/batch/distributor/all", async (req, res) => {
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

    // distributor-owned: currentOwner != manufacturer AND not revoked
    const distributorBatches = formatted.filter(
      (b: any) =>
        !b.revoked &&
        b.currentOwner &&
        b.manufacturer &&
        b.currentOwner.toLowerCase() !== b.manufacturer.toLowerCase(),
    );

    res.json({ success: true, data: distributorBatches });
  } catch (err: any) {
    console.error("Error fetching distributor batches:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 2. Create a new pharmacy order (pharmacy orders from distributor)
app.post("/pharmacy-orders", async (req, res) => {
  try {
    const { batchId, distributor, pharmacy, contact } = req.body;
    const quantity = Number(req.body.quantity);
    if (!batchId || !distributor || !pharmacy || !quantity) {
      return res
        .status(400)
        .json({ success: false, message: "Missing fields" });
    }
    console.log(quantity);
    const existingOrder = await PharmacyOrder.findOne({ where: { batchId } });
    if (existingOrder) {
      return res.status(400).json({
        success: false,
        message: "Order already made for this batch.",
      });
    }

    const order = await PharmacyOrder.create({
      batchId,
      distributor,
      pharmacy,
      contact: contact ?? null,
      status: "pending",
      quantity,
    });

    res.json({ success: true, data: order });
  } catch (err) {
    console.error("Error creating pharmacy order:", err);
    res.status(500).json({ success: false, message: err });
  }
});

// 3. Distributor: list orders assigned to them (to confirm and set price)
app.get("/pharmacy/distributor/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    const orders = await PharmacyOrder.findAll({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("distributor")),
        wallet,
      ),
    });

    res.json({ success: true, data: orders });
  } catch (err: any) {
    console.error("Error fetching distributor pharmacy orders:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 4. Pharmacy: list their orders
app.get("/pharmacy-orders/pharmacy/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    const orders = await PharmacyOrder.findAll({ where: { pharmacy: wallet } });
    res.json({ success: true, data: orders });
  } catch (err: any) {
    console.error("Error fetching pharmacy orders:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Distributor confirms order and sets price
app.post("/pharmacy-orders/confirm", async (req, res) => {
  try {
    const { price, id } = req.body;
    const order = await PharmacyOrder.findByPk(id);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    order.price = price ?? order.price;
    order.status = "seller_confirmed";
    await order.save();

    res.json({
      success: true,
      data: order,
      message: "Order confirmed with price",
    });
  } catch (err: any) {
    console.error("Error confirming pharmacy order:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/pharmacy/check-updates/:wallet", async (req, res) => {
  try {
    const pharmacy = req.params.wallet?.toLowerCase();
    if (!pharmacy) {
      return res
        .status(400)
        .json({ success: false, message: "Missing pharmacy wallet" });
    }

    const awaitingOrders = await PharmacyOrder.findAll({
      where: { pharmacy, status: "awaiting_payment" },
    });

    if (!awaitingOrders || awaitingOrders.length === 0) {
      return res.json({ success: true, data: [] });
    }

    res.json({ success: true, data: awaitingOrders });
  } catch (err) {
    console.error("Error fetching awaiting payment orders:", err);
    res.status(500).json({ success: false, message: err });
  }
});

app.post("/pharmacy-orders/:id/pay", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { phone } = req.body;

    const order = await PharmacyOrder.findByPk(id);
    if (!order)
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });

    if (order.status !== "seller_confirmed")
      return res
        .status(400)
        .json({ success: false, message: "Order not payable" });

    // 🔐 STK Push
    const amount = Number(order.price); // or whatever field has the amount
    const mpesaResponse = await initiateSTKPushPharmacy(
      order.id,
      phone,
      amount,
    );
    (order as any).checkoutRequestId = mpesaResponse.CheckoutRequestID;
    (order as any).paymentStatus = "PENDING";
    await order.save();

    res.json({ success: true, checkoutId: mpesaResponse.CheckoutRequestID });
  } catch (err) {
    console.error("Mpesa initiation error:", err);
    res.status(500).json({ success: false });
  }
});

app.post("/orders/mpesa/callback/pharmacy", async (req, res) => {
  try {
    const stk = req.body.Body.stkCallback;

    if (stk.ResultCode !== 0) return res.json({ ok: true });

    const checkoutId = stk.CheckoutRequestID;

    const order = await PharmacyOrder.findOne({
      where: { checkoutRequestId: checkoutId },
    });

    if (!order) return res.json({ ok: true });

    // ✅ PAYMENT IS REAL
    order.status = "paid";
    await order.save();

    // 🔗 ON-CHAIN TRANSFER
    const tx = await contract.transferOwnership(order.batchId, order.pharmacy);
    const receipt = await tx.wait();

    if (receipt.status !== 1) throw new Error("On-chain transfer failed");

    const qty = Number(order.quantity);

    // 1️⃣ Distributor stock ↓
    const distributorStock = await Stock.findOne({
      where: {
        batchId: order.batchId,
        ownerWallet: order.distributor.toLowerCase(),
        role: 2,
      },
    });

    if (!distributorStock || distributorStock.quantity < qty)
      throw new Error("Insufficient distributor stock");

    await distributorStock.decrement({ quantity: qty });

    // 2️⃣ Pharmacy stock ↑
    const pharmacyStock = await Stock.findOne({
      where: {
        batchId: order.batchId,
        ownerWallet: order.pharmacy.toLowerCase(),
        role: 3,
      },
    });

    if (pharmacyStock) {
      await pharmacyStock.increment({ quantity: qty });
    } else {
      await Stock.create({
        batchId: order.batchId,
        ownerWallet: order.pharmacy.toLowerCase(),
        role: 3,
        quantity: qty,
        status: "active",
      });
    }

    // 🧾 Audit
    await AuditTrail.create({
      orderId: order.id,
      batchId: order.batchId,
      from: order.distributor,
      to: order.pharmacy,
      action: "OWNERSHIP_TRANSFER_SUCCESS",
      txHash: receipt.hash,
    });

    order.status = "completed";
    order.ownershipTransferred = true;
    order.txHash = receipt.hash;
    await order.save();

    res.json({ ok: true });
  } catch (err) {
    console.error("Pharmacy Mpesa callback error:", err);
    res.json({ ok: true });
  }
});

app.get("/batches/pharmacy/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
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

    const owned = formatted.filter(
      (b: any) => b.currentOwner?.toLowerCase() === wallet,
    );
    res.json({ success: true, data: owned });
  } catch (err: any) {
    console.error("Error fetching pharmacy-owned batches:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Pharmacy stock view
app.get("/stock/pharmacy/:wallet", async (req, res) => {
  try {
    const wallet = (req.params.wallet || "").toLowerCase();
    if (!wallet) {
      return res
        .status(400)
        .json({ success: false, message: "Wallet required" });
    }

    // Fetch stock entries for this pharmacy
    const stocks = await Stock.findAll({
      where: {
        ownerWallet: wallet,
        role: 3,
      },
    });

    // Map to simple object
    const stockData = stocks.map((s) => ({
      batchId: s.batchId,
      quantity: s.quantity,
      status: s.status,
    }));

    res.json({ success: true, data: stockData });
  } catch (err) {
    console.error("Error fetching pharmacy stock:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch pharmacy stock" });
  }
});

// -------------------- START SERVER --------------------
(async () => {
  try {
    await sequelize.sync({ alter: true });
    const seedPPBRecords = async () => {
      const count = await PPBRecord.count();
      if (count === 0) {
        const sample: Array<{
          name: string;
          email: string;
          licenseNumber: string;
          role: number;
        }> = [];

        // 1 = Manufacturer
        const manufacturers = [
          "Beta Healthcare International Ltd",
          "Cosmos Pharmaceutical Ltd",
          "Dawa Life Sciences",
          "Biodeal Laboratories Ltd",
          "Universal Corporation Ltd",
          "Ray Pharmaceuticals Ltd",
          "Aspen Kenya Ltd",
          "Concept Africa Pharmaceuticals Ltd",
          "Didy Pharmaceuticals Ltd",
          "Gesto Pharmaceuticals Ltd",
        ];
        manufacturers.forEach((nm, idx) => {
          sample.push({
            name: nm,
            email:
              nm.toLowerCase().replace(/[^a-z]/g, "") + "@manufacturer.co.ke",
            licenseNumber: `PPBMFG${(100000000000 + idx).toString().padStart(10, "0")}`,
            role: 1,
          });
        });

        // 2 = Distributor
        const distributors = [
          "Prunus Pharma Ltd",
          "Regal Pharmaceuticals Ltd",
          "Omaera Pharmaceuticals Ltd",
          "Transchem Pharmaceuticals Ltd",
          "Harleys Ltd",
          "Zadchem Healthcare Ltd",
          "Abacus Pharma (K) Ltd",
          "Temple Stores Pharmaceuticals",
          "Rangechem Pharmaceuticals",
          "Veteran Pharmaceuticals Ltd",
        ];
        distributors.forEach((nm, idx) => {
          sample.push({
            name: nm,
            email:
              nm.toLowerCase().replace(/[^a-z]/g, "") + "@distributor.co.ke",
            licenseNumber: `PPBDST${(200000000000 + idx).toString().padStart(10, "0")}`,
            role: 2,
          });
        });

        // 3 = Pharmacist
        const pharmacists = [
          "Jane Mwangi",
          "Peter Otieno",
          "Catherine Wambui",
          "Michael Kilonzo",
          "Alice Njeri",
          "Samuel Odhiambo",
          "Esther Kamau",
          "George Mutiso",
          "Florence Chege",
          "David Oloo",
        ];
        pharmacists.forEach((nm, idx) => {
          sample.push({
            name: nm,
            email: nm.toLowerCase().replace(/ /g, ".") + "@pharmacist.co.ke",
            licenseNumber: `PPBPHM${(300000000000 + idx).toString().padStart(10, "0")}`,
            role: 3,
          });
        });

        await PPBRecord.bulkCreate(sample);
        console.log(
          "✅ Seeded realistic PPB registry entries (Manufacturers, Distributors, Pharmacists).",
        );
      }
    };

    seedPPBRecords().catch((err) => console.error("Seeding error:", err));

    app.listen(PORT, () => {
      console.log(`✅ Backend running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("Server start error:", err);
    process.exit(1);
  }
})();
