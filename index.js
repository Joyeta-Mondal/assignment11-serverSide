require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
// require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// Middlewares
app.use(
  cors({
    origin: [
      // "http://localhost:5173",
      "https://assignment11-client-c377c.web.app",
    ],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
};

// Verify JWT Token Middleware
const verifyToken = (req, res, next) => {
  const token = req?.cookies?.token;
  if (!token) {
    return res.status(403).send("A token is required for authentication");
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
  } catch (err) {
    return res.status(401).send("Invalid Token");
  }
  return next();
};

// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pebpd.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // await client.connect();
    console.log("MongoDB Connected");

    const database = client.db("bookWarts");
    const bookCollection = database.collection("books");
    const borrowCollection = database.collection("borrow");

    app.get("/", (req, res) => {
      res.send("Server!");
    });

    // JWT Token Endpoint
    app.post("/jwt", (req, res) => {
      const { user } = req.body;
      const token = jwt.sign({ user }, process.env.JWT_SECRET, {
        expiresIn: "5h",
      });
      res.cookie("token", token, cookieOptions).send({ success: "Token sent" });
    });

    // Logout Endpoint
    app.post("/logout", (req, res) => {
      res.clearCookie("token", cookieOptions).send({ success: "Logged out" });
    });

    // Add Book Endpoint

    app.get("/api/books", async (req, res) => {
      const email = req.query.email;
      let query = {};
      if (email) {
        query = { userEmail: email };
      }
      const books = await bookCollection.find(query).toArray();
      res.send(books);
    });

    app.get("/api/books/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const book = await bookCollection.findOne(query); // Use findOne instead of find.
        if (book) {
          res.send(book); // Send the book directly.
        } else {
          res.status(404).send({ error: "Book not found" });
        }
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch book", details: error.message });
      }
    });

    app.put("/api/books/:bookId", async (req, res) => {
      try {
        const { bookId } = req.params;
        const updatedBook = req.body;

        // Remove the _id field from the updatedBook data to avoid updating the immutable field
        const { _id, ...updateData } = updatedBook;

        // Convert bookId to ObjectId
        const objectId = new ObjectId(bookId);

        const result = await bookCollection.updateOne(
          { _id: objectId }, // Filter by bookId
          { $set: updateData } // Update the book with the new data (excluding _id)
        );

        if (result.modifiedCount > 0) {
          res.status(200).send("Book updated successfully");
        } else {
          res.status(400).send("No changes made to the book");
        }
      } catch (error) {
        console.error("Error updating book:", error);
        res.status(500).send("Server error");
      }
    });

    app.post("/api/books", verifyToken, async (req, res) => {
      try {
        const {
          image,
          name,
          quantity,
          author,
          category,
          description,
          rating,
          userEmail,
        } = req.body;
        const newBook = {
          image,
          name,
          quantity: parseInt(quantity, 10),
          author,
          category,
          description,
          rating: parseFloat(rating),
          createdAt: new Date(),
          userEmail,
        };

        const result = await bookCollection.insertOne(newBook);
        res.status(201).send({
          success: "Book added successfully!",
          insertedId: result.insertedId,
        });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to add book", details: error.message });
      }
    });

    // Get All Books Endpoint
    app.get("/api/books", verifyToken, async (req, res) => {
      try {
        const books = await bookCollection.find().toArray();
        res.status(200).send(books);
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to fetch books", details: error.message });
      }
    });

    app.post("/api/borrow/:id", async (req, res) => {
      try {
        const bookId = req.params.id; // Extract book ID from params
        const { userId, returnDate } = req.body; // Extract user and return date from the request body

        // Validate book existence and ensure its quantity is greater than 0
        const book = await bookCollection.findOne({
          _id: new ObjectId(bookId),
        });

        if (!book) {
          return res.status(404).send({ error: "Book not found" });
        }

        if (book.quantity <= 0) {
          return res.status(400).send({ error: "Book is out of stock" });
        }

        // Decrement the book quantity using $inc
        const updateResult = await bookCollection.updateOne(
          { _id: new ObjectId(bookId) },
          { $inc: { quantity: -1 } }
        );

        if (updateResult.matchedCount === 0) {
          return res
            .status(500)
            .send({ error: "Failed to update book quantity" });
        }

        // Add the book borrow information to the "borrowedBooks" collection
        const borrowEntry = {
          bookId: new ObjectId(bookId),
          userId,
          returnDate,
          borrowedAt: new Date(),
        };

        const borrowResult = await borrowCollection.insertOne(borrowEntry);

        res.send({
          success: "Book borrowed successfully",
          borrowId: borrowResult.insertedId,
        });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to borrow book", details: error.message });
      }
    });

    // Get Borrowed Books for the Logged-in User
    app.get("/api/borrowed-books", async (req, res) => {
      try {
        const userEmail = req.query.email;

        if (!userEmail) {
          return res.status(400).send({ error: "User email is required" });
        }

        const borrowedBooks = await borrowCollection
          .aggregate([
            { $match: { userId: userEmail } }, // Fix field to match your schema
            {
              $lookup: {
                from: "books",
                localField: "bookId",
                foreignField: "_id",
                as: "bookDetails",
              },
            },
            { $unwind: "$bookDetails" },
          ])
          .toArray();

        res.send(borrowedBooks);
      } catch (error) {
        res.status(500).send({
          error: "Failed to fetch borrowed books",
          details: error.message,
        });
      }
    });

    // Return a Borrowed Book
    app.post("/api/return-book/:id", async (req, res) => {
      try {
        const borrowId = req.params.id;

        // Find the borrowed book entry
        const borrowedBook = await borrowCollection.findOne({
          _id: new ObjectId(borrowId),
        });

        if (!borrowedBook) {
          return res.status(404).send({ error: "Borrowed book not found" });
        }

        // Increment the book's quantity by 1
        const updateResult = await bookCollection.updateOne(
          { _id: borrowedBook.bookId },
          { $inc: { quantity: 1 } }
        );

        if (updateResult.matchedCount === 0) {
          return res
            .status(500)
            .send({ error: "Failed to update book quantity" });
        }

        // Remove the borrowed book entry
        const deleteResult = await borrowCollection.deleteOne({
          _id: new ObjectId(borrowId),
        });

        res.send({ success: "Book returned successfully" });
      } catch (error) {
        res
          .status(500)
          .send({ error: "Failed to return book", details: error.message });
      }
    });
  } finally {
    // Ensures the client will close on error
    // await client.close();
  }
}
run().catch(console.dir);

// Start the Server
app.listen(port, () => {
  console.log(`Server running on port: ${port}`);
});
