// Card images (you will place these in /images/)
const cardImages = {
    Rock: "images/rock.png",
    Paper: "images/paper.png",
    Scissors: "images/scissors.png"
};

// Starting hands
let playerHand = ["Rock", "Paper", "Scissors"];
let cpuHand = ["Rock", "Paper", "Scissors"];

// Render hands
function renderHands() {
    const playerDiv = document.getElementById("player-hand");
    const cpuDiv = document.getElementById("cpu-hand");

    playerDiv.innerHTML = "";
    cpuDiv.innerHTML = "";

    playerHand.forEach((card, index) => {
        const img = document.createElement("img");
        img.src = cardImages[card];
        img.className = "card";
        img.onclick = () => playRound(index);
        playerDiv.appendChild(img);
    });

    cpuHand.forEach(card => {
        const img = document.createElement("img");
        img.src = cardImages[card];
        img.className = "card";
        cpuDiv.appendChild(img);
    });
}

// CPU chooses a random card
function cpuChoose() {
    return Math.floor(Math.random() * cpuHand.length);
}

// Determine winner
function winner(player, cpu) {
    if (player === cpu) return "Tie!";
    if (
        (player === "Rock" && cpu === "Scissors") ||
        (player === "Paper" && cpu === "Rock") ||
        (player === "Scissors" && cpu === "Paper")
    ) return "You Win!";
    return "CPU Wins!";
}

// Dice roll for replacement (50% chance)
function maybeReplace(hand) {
    if (Math.random() < 0.5) {
        const cards = ["Rock", "Paper", "Scissors"];
        const newCard = cards[Math.floor(Math.random() * 3)];
        hand.push(newCard);
    }
}

function playRound(playerIndex) {
    const cpuIndex = cpuChoose();

    const playerCard = playerHand[playerIndex];
    const cpuCard = cpuHand[cpuIndex];

    // Remove used cards
    playerHand.splice(playerIndex, 1);
    cpuHand.splice(cpuIndex, 1);

    // Dice roll replacement
    maybeReplace(playerHand);
    maybeReplace(cpuHand);

    // Show result
    document.getElementById("result").innerHTML =
        `You played <b>${playerCard}</b> — CPU played <b>${cpuCard}</b><br><br>` +
        winner(playerCard, cpuCard);

    renderHands();
}

// Start game
renderHands();
