"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const body_parser_1 = __importDefault(require("body-parser"));
const ethers_1 = require("ethers");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const sequelize_1 = require("sequelize");
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(body_parser_1.default.json());
// -------------------- ENV VARIABLES --------------------
const GANACHE_RPC = process.env.GANACHE_RPC || "http://127.0.0.1:8545";
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const PORT = Number(process.env.PORT || 5000);
// -------------------- DATABASE (SQLite + Sequelize) --------------------
const sequelize = new sequelize_1.Sequelize({
    dialect: "sqlite",
    storage: path_1.default.join(__dirname, "../pharmadb.sqlite"),
    logging: false,
});
// -------------------- MODELS --------------------
// User = application users who sign up and later get approved
class User extends sequelize_1.Model {
}
User.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    email: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    role: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    walletAddress: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    licenseNumber: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    status: { type: sequelize_1.DataTypes.STRING, allowNull: false, defaultValue: "pending" },
}, { sequelize, modelName: "User", timestamps: false });
// PpbUser = mock PPB registry
class PPBRecord extends sequelize_1.Model {
}
PPBRecord.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    email: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    licenseNumber: { type: sequelize_1.DataTypes.STRING, allowNull: false, unique: true },
    role: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: "PPBRecord", timestamps: false });
// -------------------- ORDER & AUDIT MODELS --------------------
class Order extends sequelize_1.Model {
}
Order.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    batchId: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    seller: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    buyer: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    price: { type: sequelize_1.DataTypes.FLOAT, allowNull: true },
    status: { type: sequelize_1.DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    txHash: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    contact: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    ownershipTransferred: {
        type: sequelize_1.DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
    },
}, { sequelize, modelName: "Order", timestamps: true });
// Audit trail
class AuditTrail extends sequelize_1.Model {
}
AuditTrail.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    orderId: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    batchId: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    from: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    to: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    action: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    txHash: { type: sequelize_1.DataTypes.STRING, allowNull: true },
}, { sequelize, modelName: "AuditTrail", timestamps: true });
async function createAuditEntry(entry) {
    await AuditTrail.create(entry);
}
// models/PharmacyOrder.ts
class PharmacyOrder extends sequelize_1.Model {
}
PharmacyOrder.init({
    id: { type: sequelize_1.DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    batchId: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    distributor: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    pharmacy: { type: sequelize_1.DataTypes.STRING, allowNull: false },
    price: { type: sequelize_1.DataTypes.FLOAT, allowNull: true },
    status: { type: sequelize_1.DataTypes.STRING, allowNull: false, defaultValue: "pending" },
    txHash: { type: sequelize_1.DataTypes.STRING, allowNull: true },
    ownershipTransferred: { type: sequelize_1.DataTypes.BOOLEAN, allowNull: true, defaultValue: false },
    contact: { type: sequelize_1.DataTypes.STRING, allowNull: true },
}, { sequelize, modelName: "PharmacyOrder", timestamps: true });
exports.default = PharmacyOrder;
// -------------------- BLOCKCHAIN SETUP --------------------
const contractPath = path_1.default.join(__dirname, "../contracts/PharmaTrustChain.json");
if (!fs_1.default.existsSync(contractPath)) {
    console.error("ERROR: Contract ABI missing at", contractPath);
    process.exit(1);
}
const contractJson = JSON.parse(fs_1.default.readFileSync(contractPath, "utf8"));
const contractABI = contractJson.abi;
const provider = new ethers_1.ethers.JsonRpcProvider(GANACHE_RPC);
const wallet = new ethers_1.ethers.Wallet(PRIVATE_KEY, provider);
const contract = new ethers_1.ethers.Contract(CONTRACT_ADDRESS, contractABI, wallet);
// -------------------- HELPERS --------------------
function isValidAddress(a) {
    try {
        return ethers_1.ethers.isAddress(a);
    }
    catch {
        return false;
    }
}
// -------------------- ROUTES --------------------
app.post("/signup", async (req, res) => {
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
        const nameMatch = ppbRecord.name.trim().toLowerCase() === name.trim().toLowerCase();
        const emailMatch = ppbRecord.email.trim().toLowerCase() === email.trim().toLowerCase();
        const roleMatch = ppbRecord.role === Number(role);
        if (!nameMatch || !emailMatch || !roleMatch) {
            res.status(400).json({
                success: false,
                message: "❌ Submitted details do not match PPB registry record. Check your name, email or role again !!!",
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
            message: "✅ Registration verified with PPB registry. Awaiting admin approval.",
        });
    }
    catch (error) {
        console.error("Signup error:", error);
        res
            .status(500)
            .json({ error: error.message || "Internal Server Error" });
    }
});
// LOGIN
app.post("/login", async (req, res) => {
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
    }
    catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Login failed" });
    }
});
//ADMIN - Pending requests
app.get("/pending-requests", async (_req, res) => {
    try {
        const pending = await User.findAll({ where: { status: "pending" } });
        res.json({ success: true, data: pending });
    }
    catch (err) {
        console.error("Fetch error:", err);
        res.status(500).json({ error: "Failed to fetch pending requests" });
    }
});
// ADMIN - Approve
app.post("/approve-request/:wallet", async (req, res) => {
    try {
        const walletAddress = req.params.wallet;
        const user = await User.findOne({ where: { walletAddress, status: "pending" } });
        if (!user) {
            res.status(404).json({ error: "User not found or already processed" });
            return;
        }
        const tx = await contract.registerUser(user.walletAddress, user.name, Number(user.role));
        await tx.wait();
        user.status = "approved";
        await user.save();
        res.json({ success: true, message: "User approved and registered on chain" });
    }
    catch (err) {
        console.error("Approval error:", err);
        res.status(500).json({ error: err.message || "Failed to approve user" });
    }
});
// ADMIN - Reject
app.post("/reject-request/:wallet", async (req, res) => {
    try {
        const walletAddress = req.params.wallet;
        const user = await User.findOne({ where: { walletAddress, status: "pending" } });
        if (!user) {
            res.status(404).json({ error: "User not found or already processed" });
            return;
        }
        await user.destroy();
        res.json({ success: true, message: "User registration rejected" });
    }
    catch (err) {
        console.error("Rejection error:", err);
        res.status(500).json({ error: "Failed to reject user" });
    }
});
// FETCH ALL BATCHES (for frontend use)
app.get("/batches", async (_req, res) => {
    try {
        const batches = await contract.getAllBatches();
        const formatted = batches.map((b) => ({
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
    }
    catch (error) {
        console.error("Error fetching batches:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch batches from blockchain",
            error: error.message,
        });
    }
});
// Mock PPB API
app.get("/api/ppb", async (_req, res) => {
    try {
        const records = await PPBRecord.findAll();
        res.json({ success: true, data: records });
    }
    catch (error) {
        res.status(500).json({ error: "Failed to fetch PPB records" });
    }
});
//Check user status (used by frontend polling)
app.get("/api/user-status/:wallet", async (req, res) => {
    try {
        const { wallet } = req.params;
        const user = await User.findOne({ where: { walletAddress: wallet } });
        if (!user) {
            res.status(404).json({ status: "not_found" });
            return;
        }
        res.json({ status: user.status });
    }
    catch (error) {
        console.error("User status check error:", error);
        res.status(500).json({ error: "Failed to check user status" });
    }
});
// ---------- PINATA UPLOAD (pins JSON metadata) ----------
app.post("/pinata/upload", async (req, res) => {
    try {
        const metadata = req.body.metadata ?? req.body;
        const PINATA_JWT = process.env.PINATA_JWT;
        if (!PINATA_JWT) {
            return res.status(500).json({ error: "Pinata JWT not configured on server" });
        }
        const pinataEndpoint = "https://api.pinata.cloud/pinning/pinJSONToIPFS";
        const response = await (0, node_fetch_1.default)(pinataEndpoint, {
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
        const ipfsHash = raw.IpfsHash ||
            raw.ipfsHash ||
            null;
        if (!ipfsHash) {
            console.error("Pinata response missing hash:", raw);
            return res.status(500).json({ error: "Pinata response missing hash", raw });
        }
        res.json({ success: true, ipfsHash });
    }
    catch (err) {
        console.error("Pinata upload error:", err);
        res.status(500).json({ error: err.message || "Pinata upload failed" });
    }
});
//get manufacturers batches
app.get("/manufacturer/batches", async (req, res) => {
    try {
        const { walletAddress } = req.query;
        if (!walletAddress) {
            return res.status(400).json({ success: false, message: "Missing wallet address" });
        }
        // Use the globally defined contract instance
        const batches = await contract.getBatchesByManufacturer(walletAddress);
        // Format and return the data
        const formatted = batches.map((batch) => ({
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
    }
    catch (error) {
        console.error("Error fetching manufacturer batches:", error);
        res.status(500).json({ success: false, message: "Error fetching manufacturer batches" });
    }
});
// GET /admin/all-batches  -> reads all batches from contract (returns array)
app.get("/admin/all-batches", async (_req, res) => {
    try {
        // call contract.getAllBatches()
        const raw = await contract.getAllBatches();
        // raw is an array of tuple/structs; transform to plain objects
        const batches = raw.map((b) => ({
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
    }
    catch (err) {
        console.error("Fetch all batches error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch batches" });
    }
});
// POST /admin/revoke/:id  -> server wallet calls contract.revokeBatch(batchId, reason)
app.post("/revoke-batch/:id", async (req, res) => {
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
    }
    catch (err) {
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
    }
    catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).json({ success: false, error: "Server error" });
    }
});
// -------------------- ORDER / PAYMENT ROUTES --------------------
// POST /orders/confirm
app.post("/orders/confirm", async (req, res) => {
    try {
        const { orderId, amount } = req.body;
        if (!orderId || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: "Invalid payload" });
        }
        // Find the order by ID
        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }
        // Only allow confirming orders in "pending" status
        if (order.status !== "pending") {
            return res.status(400).json({ success: false, message: "Order cannot be confirmed" });
        }
        // Update order details
        order.price = amount;
        order.status = "awaiting_payment";
        await order.save();
        // Optional: create an audit entry if you have audit logging
        await createAuditEntry({
            orderId: order.id,
            batchId: order.batchId,
            from: order.seller,
            to: order.buyer,
            action: "order_confirmed",
        });
        res.json({ success: true, message: "Order confirmed successfully!", order });
    }
    catch (err) {
        console.error("Confirm order error:", err);
        res.status(500).json({ success: false, message: err.message || "Failed to confirm order" });
    }
});
// Create new order
app.post("/orders/create", async (req, res) => {
    try {
        const { batchId, buyer, seller, status, contact } = req.body;
        if (!batchId || !buyer || !seller) {
            res.status(400).json({ success: false, message: "Missing required fields." });
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
        });
        res.json({
            success: true,
            message: "Order placed successfully!",
            data: newOrder,
        });
    }
    catch (err) {
        console.error("Error creating order:", err);
        res.status(500).json({
            success: false,
            message: "Error creating order.",
        });
    }
});
// GET /orders/manufacturer/:wallet
app.get("/orders/manufacturer/:wallet", async (req, res) => {
    try {
        const wallet = (req.params.wallet || "").toLowerCase().trim();
        if (!wallet) {
            return res.status(400).json({ success: false, message: "Missing wallet address" });
        }
        const orders = await Order.findAll({
            where: sequelize_1.Sequelize.where(sequelize_1.Sequelize.fn("lower", sequelize_1.Sequelize.col("seller")), wallet),
        });
        res.json({ success: true, data: orders });
    }
    catch (err) {
        console.error("Fetch manufacturer orders error:", err);
        res.status(500).json({ success: false, message: "Failed to fetch orders", error: err.message });
    }
});
// ✅ Get all awaiting-payment orders for a distributor
app.get("/orders/distributor/:wallet/awaiting", async (req, res) => {
    try {
        const wallet = (req.params.wallet || "").toLowerCase().trim();
        if (!wallet) {
            return res.status(400).json({ success: false, message: "Missing wallet address" });
        }
        const orders = await Order.findAll({
            where: { status: "awaiting_payment" },
            order: [["createdAt", "DESC"]],
        });
        const filtered = orders.filter(order => order.buyer.toLowerCase() === wallet);
        if (filtered.length === 0) {
            return res.json({ success: true, data: [] });
        }
        res.json({ success: true, data: filtered });
    }
    catch (err) {
        console.error("Error fetching awaiting payment orders:", err);
        res.status(500).json({
            success: false,
            message: "Failed to fetch awaiting payment orders",
            error: err.message,
        });
    }
});
// Audit Record
app.post("/orders/pay", async (req, res) => {
    try {
        const { batchId, buyer, seller } = req.body;
        // 1️⃣ Verify order from DB
        const order = await Order.findOne({ where: { batchId, buyer, seller, status: "awaiting_payment" } });
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found or already paid." });
        }
        // 2️⃣ Call contract to transfer ownership (admin/operator as signer)
        const tx = await contract.transferOwnership(batchId, buyer);
        const receipt = await tx.wait();
        // 3️⃣ Only mark as paid if on-chain success
        if (receipt.status === 1) {
            order.status = "paid";
            order.ownershipTransferred = true; // 🆕 mark it as done
            await order.save();
            await AuditTrail.create({
                orderId: order.id,
                batchId,
                from: seller,
                to: buyer,
                action: "Ownership Transferred",
                txHash: receipt.transactionHash,
            });
            return res.json({
                success: true,
                message: "Payment confirmed and ownership transferred on-chain.",
                txHash: receipt.transactionHash,
            });
        }
        else {
            return res.status(500).json({ success: false, message: "On-chain transaction failed." });
        }
    }
    catch (err) {
        console.error("⚠️ Error in /orders/pay:", err);
        res.status(500).json({
            success: false,
            message: "Payment confirmation failed."
        });
    }
});
app.post("/audit/batch-created", async (req, res) => {
    try {
        const { batchId, manufacturerWallet, txHash } = req.body;
        console.log(txHash);
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
        res.json({
            success: true,
            message: "Audit trail recorded successfully",
            data: audit,
        });
    }
    catch (err) {
        console.error("Error recording audit trail:", err);
        res.status(500).json({
            success: false,
            message: "Failed to record audit trail",
        });
    }
});
// 🧾 Fetch all audit logs (admin sees everything)
app.get("/audit", async (req, res) => {
    try {
        const audits = await AuditTrail.findAll({
            order: [["createdAt", "DESC"]],
        });
        res.json({ success: true, data: audits });
    }
    catch (err) {
        console.error("⚠️ Error fetching audit logs:", err);
        res.status(500).json({ success: false, message: "Failed to fetch audit logs" });
    }
});
app.get("/batches/distributor/:wallet", async (req, res) => {
    try {
        const wallet = req.params.wallet.toLowerCase();
        // 🔹 1. Fetch all blockchain batches
        const batches = await contract.getAllBatches();
        const formatted = batches.map((b) => ({
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
        const availableBatches = formatted.filter((b) => !b.revoked &&
            !transferredIds.includes(b.id) &&
            b.currentOwner.toLowerCase() === b.manufacturer.toLowerCase());
        // (B) Batches owned by the distributor (already purchased)
        const ownedBatches = formatted.filter((b) => b.currentOwner.toLowerCase() === wallet);
        // 🔹 4. Merge and return unique list
        const combined = [
            ...availableBatches,
            ...ownedBatches.filter((ob) => !availableBatches.some((ab) => ab.id === ob.id)),
        ];
        res.json({ success: true, data: combined });
    }
    catch (error) {
        console.error("Error fetching distributor batches:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch distributor batches",
            error: error.message,
        });
    }
});
// ______________________________Pharmacy_Routes______________________________________________
// 1. Get all batches currently owned by any distributor (for pharmacy to browse)
app.get("/batch/distributor/all", async (req, res) => {
    try {
        const batches = await contract.getAllBatches();
        const formatted = batches.map((b) => ({
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
        const distributorBatches = formatted.filter((b) => !b.revoked &&
            b.currentOwner &&
            b.manufacturer &&
            b.currentOwner.toLowerCase() !== b.manufacturer.toLowerCase());
        res.json({ success: true, data: distributorBatches });
    }
    catch (err) {
        console.error("Error fetching distributor batches:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// 2. Create a new pharmacy order (pharmacy orders from distributor)
app.post("/pharmacy-orders", async (req, res) => {
    try {
        const { batchId, distributor, pharmacy, contact } = req.body;
        if (!batchId || !distributor || !pharmacy) {
            return res.status(400).json({ success: false, message: "Missing fields" });
        }
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
        });
        res.json({ success: true, data: order });
    }
    catch (err) {
        console.error("Error creating pharmacy order:", err);
        res.status(500).json({ success: false, message: err });
    }
});
// 3. Distributor: list orders assigned to them (to confirm and set price)
app.get("/pharmacy/distributor/:wallet", async (req, res) => {
    try {
        const wallet = (req.params.wallet || "").toLowerCase();
        const orders = await PharmacyOrder.findAll({
            where: sequelize.where(sequelize.fn("LOWER", sequelize.col("distributor")), wallet)
        });
        res.json({ success: true, data: orders });
    }
    catch (err) {
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
    }
    catch (err) {
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
            return res.status(404).json({ success: false, message: "Order not found" });
        order.price = price ?? order.price;
        order.status = "seller_confirmed";
        await order.save();
        res.json({ success: true, data: order, message: "Order confirmed with price" });
    }
    catch (err) {
        console.error("Error confirming pharmacy order:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
app.get("/pharmacy/check-updates/:wallet", async (req, res) => {
    try {
        const pharmacy = req.params.wallet?.toLowerCase();
        if (!pharmacy) {
            return res.status(400).json({ success: false, message: "Missing pharmacy wallet" });
        }
        const awaitingOrders = await PharmacyOrder.findAll({
            where: { pharmacy, status: "awaiting_payment" },
        });
        if (!awaitingOrders || awaitingOrders.length === 0) {
            return res.json({ success: true, data: [] });
        }
        res.json({ success: true, data: awaitingOrders });
    }
    catch (err) {
        console.error("Error fetching awaiting payment orders:", err);
        res.status(500).json({ success: false, message: err });
    }
});
app.post("/pharmacy-orders/:id/confirm-payment", async (req, res) => {
    try {
        const id = Number(req.params.id);
        const order = await PharmacyOrder.findByPk(id);
        if (!order)
            return res.status(404).json({ success: false, message: "Order not found" });
        console.log(order);
        //  Update order status
        order.status = "paid";
        await order.save();
        // Blockchain ownership transfer
        const tx = await contract.transferOwnership(order.batchId, order.pharmacy);
        const receipt = await tx.wait();
        // Record audit trail (transfer attempt + result)
        await AuditTrail.create({
            orderId: order.id,
            batchId: order.batchId,
            from: order.distributor,
            to: order.pharmacy,
            action: receipt.status === 1
                ? "OWNERSHIP_TRANSFER_SUCCESS"
                : "OWNERSHIP_TRANSFER_FAILED",
            txHash: receipt.status === 1 ? receipt.hash : null,
        });
        if (receipt.status === 1) {
            order.status = "completed";
            order.ownershipTransferred = true;
            order.txHash = receipt.hash;
            await order.save();
            return res.json({
                success: true,
                message: "Payment confirmed and ownership transferred successfully",
                txHash: receipt.hash,
            });
        }
        else {
            return res
                .status(500)
                .json({ success: false, message: "On-chain transfer failed" });
        }
    }
    catch (err) {
        console.error("Error confirming pharmacy payment:", err);
        try {
            await AuditTrail.create({
                orderId: Number(req.params.id),
                batchId: 0,
                from: "system",
                to: "system",
                action: "ERROR_CONFIRM_PAYMENT",
                txHash: null,
            });
        }
        catch (auditErr) {
            console.error("Audit trail logging failed:", auditErr);
        }
        res.status(500).json({ success: false, message: err });
    }
});
app.get("/batches/pharmacy/:wallet", async (req, res) => {
    try {
        const wallet = (req.params.wallet || "").toLowerCase();
        const batches = await contract.getAllBatches();
        const formatted = batches.map((b) => ({
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
        const owned = formatted.filter((b) => b.currentOwner?.toLowerCase() === wallet);
        res.json({ success: true, data: owned });
    }
    catch (err) {
        console.error("Error fetching pharmacy-owned batches:", err);
        res.status(500).json({ success: false, message: err.message });
    }
});
// -------------------- START SERVER --------------------
(async () => {
    try {
        await sequelize.sync();
        const seedPPBRecords = async () => {
            const count = await PPBRecord.count();
            if (count === 0) {
                const sample = [];
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
                        email: nm.toLowerCase().replace(/[^a-z]/g, "") + "@manufacturer.co.ke",
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
                        email: nm.toLowerCase().replace(/[^a-z]/g, "") + "@distributor.co.ke",
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
                console.log("✅ Seeded realistic PPB registry entries (Manufacturers, Distributors, Pharmacists).");
            }
        };
        seedPPBRecords().catch((err) => console.error("Seeding error:", err));
        app.listen(PORT, () => {
            console.log(`✅ Backend running on http://localhost:${PORT}`);
        });
    }
    catch (err) {
        console.error("Server start error:", err);
        process.exit(1);
    }
})();
