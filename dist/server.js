"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ethers_1 = require("ethers");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const provider = new ethers_1.ethers.JsonRpcProvider(process.env.GANACHE_RPC);
if (!process.env.PRIVATE_KEY) {
    throw new Error("PRIVATE_KEY is missing in .env");
}
const wallet = new ethers_1.ethers.Wallet(process.env.PRIVATE_KEY, provider);
const artifactPath = path_1.default.join(__dirname, "..", "artifacts", "contracts", "PharmaTrustChain.sol", "PharmaTrustChain.json");
const contractABI = require(artifactPath).abi;
if (!process.env.CONTRACT_ADDRESS) {
    throw new Error("CONTRACT_ADDRESS is missing in .env");
}
const contract = new ethers_1.ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);
app.get("/verify/:batchId", async (req, res) => {
    try {
        const [valid, owner, revoked, history] = await contract.verifyProduct(req.params.batchId);
        res.json({ valid, owner, revoked, history });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
app.post("/register-product", async (req, res) => {
    const { name, batchId, ipfsHash } = req.body;
    try {
        const tx = await contract.registerProduct(name, batchId, ipfsHash);
        await tx.wait();
        res.json({ txHash: tx.hash });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
app.post("/transfer-ownership", async (req, res) => {
    const { batchId, newOwner } = req.body;
    try {
        const tx = await contract.transferOwnership(batchId, newOwner);
        await tx.wait();
        res.json({ txHash: tx.hash });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
app.post("/revoke-batch", async (req, res) => {
    const { batchId } = req.body;
    try {
        const tx = await contract.revokeBatch(batchId);
        await tx.wait();
        res.json({ txHash: tx.hash });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
