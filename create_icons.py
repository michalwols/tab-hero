from PIL import Image, ImageDraw, ImageFont

def create_icon(size):
    # Create image with dark background
    img = Image.new('RGB', (size, size), '#007acc')
    draw = ImageDraw.Draw(img)
    
    # Draw a simple tab-like shape
    margin = size // 8
    tab_height = size // 3
    
    # Draw tabs
    draw.rectangle([margin, margin, size-margin, margin+tab_height], fill='white')
    draw.rectangle([margin, margin+tab_height+5, size-margin, margin+tab_height*2+5], fill='#cccccc')
    
    img.save(f'icon{size}.png')

# Create icons in different sizes
for size in [16, 48, 128]:
    create_icon(size)

print("Icons created successfully!")
