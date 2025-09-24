import express, { Request, Response } from "express";
import cors from "cors";
import { ethers } from "ethers";
import dotenv from "dotenv";
import path from "path";

dotenv.config(); 

const app = express();
app.use(cors());
app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.GANACHE_RPC);

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is missing in .env");
}
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
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


const contractABI = require(artifactPath).abi;

if (!process.env.CONTRACT_ADDRESS) {
  throw new Error("CONTRACT_ADDRESS is missing in .env");
}

const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, contractABI, wallet);

app.get("/verify/:batchId", async (req: Request, res: Response) => {
   try {
    const [valid, owner, revoked, history] = await contract.verifyProduct(req.params.batchId);
    res.json({ valid, owner, revoked, history });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/register-product", async (req: Request, res: Response) => {
  console.log("triggered")
  const { name, batchId, ipfsHash } = req.body;
  console.log(name, batchId, ipfsHash)
  try {
    const tx = await contract.registerProduct(name, batchId, ipfsHash);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/transfer-ownership", async (req: Request, res: Response) => {
  const { batchId, newOwner } = req.body;
  try {
    const tx = await contract.transferOwnership(batchId, newOwner);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/revoke-batch", async (req: Request, res: Response) => {
  const { batchId } = req.body;
  try {
    const tx = await contract.revokeBatch(batchId);
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Backend running at http://localhost:${PORT}`));
